#[path = "../src/domain.rs"]
mod domain;
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[path = "../src/persistence/mod.rs"]
mod persistence;

use std::{fs, sync::Arc};

use domain::{default_library_state, CardKind, LibraryState, MAX_CONTENT_LENGTH};
use error::AppError;
use persistence::LibraryStore;
use serde_json::json;
use tempfile::TempDir;
use uuid::Uuid;

fn store(temp: &TempDir) -> LibraryStore {
    LibraryStore::new(temp.path().join("library"))
}

fn candidate(base: &LibraryState) -> LibraryState {
    let mut candidate = base.clone();
    candidate.revision += 1;
    candidate.skills[0].favorite = !candidate.skills[0].favorite;
    candidate
}

#[test]
fn default_library_matches_the_frontend_starter_content() {
    let state = default_library_state();
    state.validate().expect("default library must validate");
    assert_eq!(state.revision, 0);
    assert_eq!(state.skills.len(), 2);
    assert_eq!(state.mcps.len(), 3);
    assert_eq!(state.skills[0].title, "引导式多代理开发");
    assert_eq!(state.skills[1].title, "持续技术债清理");
    assert_eq!(state.mcps[0].server_name, "filesystem");
    assert_eq!(&state.mcps[0].args[..3], ["/c", "npx", "-y"]);
    assert_eq!(state.mcps[0].args[4], r"C:\Users\YOUR_NAME\Documents");
}

#[test]
fn strict_deserialization_and_validation_reject_unsafe_state() {
    let state = default_library_state();
    let mut value = serde_json::to_value(&state).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .insert("unknown".into(), json!(true));
    assert!(serde_json::from_value::<LibraryState>(value).is_err());

    let mut unsafe_server = state.clone();
    unsafe_server.mcps[0].server_name = "constructor".into();
    assert!(matches!(
        unsafe_server.validate(),
        Err(AppError::Invalid(_))
    ));

    let mut unnormalized_tag = state.clone();
    unnormalized_tag.skills[0].tags = vec!["ｗｒｉｔｉｎｇ".into()];
    assert!(matches!(
        unnormalized_tag.validate(),
        Err(AppError::Invalid(_))
    ));

    let mut duplicate_tag = state.clone();
    duplicate_tag.skills[0].tags = vec!["Writing".into(), "writing".into()];
    assert!(matches!(
        duplicate_tag.validate(),
        Err(AppError::Invalid(_))
    ));

    let mut duplicate_id = state.clone();
    duplicate_id.mcps[0].id = duplicate_id.skills[0].id.clone();
    assert!(matches!(duplicate_id.validate(), Err(AppError::Invalid(_))));

    let mut invalid_kind = state;
    invalid_kind.skills[0].kind = CardKind::Mcp;
    assert!(matches!(invalid_kind.validate(), Err(AppError::Invalid(_))));
}

#[test]
fn candidate_revision_must_be_exactly_base_plus_one() {
    let state = default_library_state();
    assert!(candidate(&state).validate_candidate(0).is_ok());
    assert!(matches!(
        state.validate_candidate(0),
        Err(AppError::Invalid(_))
    ));
}

#[test]
fn initializes_commits_and_reopens_from_disk() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    let initial = storage.load().unwrap();
    assert_eq!(initial, default_library_state());
    assert!(storage.root().join("slot-a.json").is_file());
    assert!(storage.root().join("meta.json").is_file());
    assert!(storage.root().join("seed-pack.json").is_file());

    let next = candidate(&initial);
    assert_eq!(
        storage.commit(initial.revision, next.clone()).unwrap(),
        next
    );
    assert!(storage.root().join("slot-b.json").is_file());
    assert_eq!(store(&temp).load().unwrap(), next);
}

#[test]
fn rejects_stale_revisions_without_overwriting_the_committed_state() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    let initial = storage.load().unwrap();
    let committed = candidate(&initial);
    storage.commit(0, committed.clone()).unwrap();

    let error = storage.commit(0, candidate(&initial)).unwrap_err();
    match error {
        AppError::Conflict { current } => assert_eq!(*current, committed),
        other => panic!("expected conflict, got {other:?}"),
    }
    assert_eq!(storage.load().unwrap(), committed);
}

#[test]
fn serializes_concurrent_commits_with_the_same_base_revision() {
    let temp = TempDir::new().unwrap();
    let storage = Arc::new(store(&temp));
    let initial = storage.load().unwrap();
    let first = candidate(&initial);
    let mut second = candidate(&initial);
    second.preferences.manager_view = domain::LibraryView::Mcps;

    let left_store = Arc::clone(&storage);
    let left = std::thread::spawn(move || left_store.commit(0, first));
    let right_store = Arc::clone(&storage);
    let right = std::thread::spawn(move || right_store.commit(0, second));
    let results = [left.join().unwrap(), right.join().unwrap()];

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(AppError::Conflict { .. })))
            .count(),
        1
    );
    assert_eq!(storage.load().unwrap().revision, 1);
}

#[test]
fn falls_back_to_the_previous_slot_when_the_active_slot_is_damaged() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    let initial = storage.load().unwrap();
    let revision_one = candidate(&initial);
    storage.commit(0, revision_one.clone()).unwrap();
    let revision_two = candidate(&revision_one);
    storage.commit(1, revision_two).unwrap();

    fs::write(storage.root().join("slot-a.json"), b"{broken").unwrap();
    let recovered = store(&temp).load().unwrap();
    assert_eq!(recovered, revision_one);
    let meta: serde_json::Value =
        serde_json::from_slice(&fs::read(storage.root().join("meta.json")).unwrap()).unwrap();
    assert_eq!(meta["activeSlot"], "b");
    assert_eq!(meta["revision"], 1);
}

#[test]
fn repairs_invalid_metadata_from_the_highest_valid_slot() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    let initial = storage.load().unwrap();
    let revision_one = candidate(&initial);
    storage.commit(0, revision_one.clone()).unwrap();
    fs::write(storage.root().join("meta.json"), b"not-json").unwrap();

    assert_eq!(store(&temp).load().unwrap(), revision_one);
    let repaired: serde_json::Value =
        serde_json::from_slice(&fs::read(storage.root().join("meta.json")).unwrap()).unwrap();
    assert_eq!(repaired["activeSlot"], "b");
}

#[test]
fn never_resets_when_both_existing_slots_are_damaged() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    storage.load().unwrap();
    fs::write(storage.root().join("slot-a.json"), b"{}").unwrap();
    fs::write(storage.root().join("slot-b.json"), b"{}").unwrap();

    assert!(matches!(store(&temp).load(), Err(AppError::Corruption(_))));
    assert_eq!(fs::read(storage.root().join("slot-a.json")).unwrap(), b"{}");
    assert_eq!(fs::read(storage.root().join("slot-b.json")).unwrap(), b"{}");
}

#[test]
fn rejects_a_serialized_slot_larger_than_four_mib_before_meta_activation() {
    let temp = TempDir::new().unwrap();
    let storage = store(&temp);
    let initial = storage.load().unwrap();
    let mut oversized = initial.clone();
    oversized.revision = 1;
    oversized.mcps.clear();
    oversized.skills = (0..41)
        .map(|index| {
            let mut skill = initial.skills[0].clone();
            skill.id = Uuid::new_v4().to_string();
            skill.title = format!("Large skill {index}");
            skill.prompt = "x".repeat(MAX_CONTENT_LENGTH);
            skill
        })
        .collect();

    let error = storage.commit(0, oversized).unwrap_err();
    assert!(matches!(error, AppError::StorageLimit { .. }));
    assert_eq!(storage.load().unwrap(), initial);
}
