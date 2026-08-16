use std::collections::{BTreeMap, HashSet};

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SLOT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CARDS: usize = 2_000;
pub const SIGNED_OUT_LIMIT_PER_KIND: usize = 3;
pub const MAX_TITLE_LENGTH: usize = 120;
pub const MAX_DESCRIPTION_LENGTH: usize = 600;
pub const MAX_CONTENT_LENGTH: usize = 100 * 1024;
pub const MAX_TAG_LENGTH: usize = 32;
pub const MAX_TAGS_PER_CARD: usize = 20;
pub const MAX_ARGS_PER_MCP: usize = 50;
pub const MAX_ENV_ENTRIES_PER_MCP: usize = 50;
pub const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

const SEED_PACK_V0_JSON: &str = include_str!("../../seed-packs/v0.json");
const SEED_PACK_V1_JSON: &str = include_str!("../../seed-packs/v1.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryAccess {
    SignedOut,
    SignedIn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CardKind {
    Skill,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryView {
    Skills,
    Mcps,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortMode {
    #[serde(rename = "updated-desc")]
    UpdatedDesc,
    #[serde(rename = "title-asc")]
    TitleAsc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryPreferences {
    pub manager_view: LibraryView,
    pub sort: SortMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Skill {
    pub id: String,
    pub kind: CardKind,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub prompt: String,
    pub install_notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpTool {
    pub id: String,
    pub kind: CardKind,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub server_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryState {
    pub schema_version: u32,
    pub revision: u64,
    pub skills: Vec<Skill>,
    pub mcps: Vec<McpTool>,
    pub preferences: LibraryPreferences,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SeedPack {
    version: u32,
    skills: Vec<Skill>,
    mcps: Vec<McpTool>,
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn ensure_length(field: &str, value: &str, min: usize, max: usize) -> AppResult<()> {
    let length = utf16_len(value);
    if length < min || length > max {
        return Err(AppError::Invalid(format!(
            "{field} length must be between {min} and {max}"
        )));
    }
    Ok(())
}

fn ensure_normalized(field: &str, value: &str) -> AppResult<()> {
    let normalized = value.nfkc().collect::<String>();
    if value != normalized.trim() {
        return Err(AppError::Invalid(format!(
            "{field} must be trimmed and NFKC-normalized"
        )));
    }
    Ok(())
}

fn ensure_uuid(field: &str, value: &str) -> AppResult<()> {
    let parsed =
        Uuid::parse_str(value).map_err(|_| AppError::Invalid(format!("{field} must be a UUID")))?;
    if !parsed.to_string().eq_ignore_ascii_case(value) {
        return Err(AppError::Invalid(format!(
            "{field} must use the canonical UUID representation"
        )));
    }
    Ok(())
}

fn ensure_timestamp(field: &str, value: &str) -> AppResult<()> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| AppError::Invalid(format!("{field} must be an ISO-8601 timestamp")))?;
    Ok(())
}

fn is_dangerous_key(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "__proto__" | "prototype" | "constructor"
    )
}

fn validate_common(
    id: &str,
    title: &str,
    description: &str,
    tags: &[String],
    created_at: &str,
    updated_at: &str,
) -> AppResult<()> {
    ensure_uuid("id", id)?;
    ensure_normalized("title", title)?;
    ensure_length("title", title, 1, MAX_TITLE_LENGTH)?;
    ensure_length("description", description, 0, MAX_DESCRIPTION_LENGTH)?;
    ensure_timestamp("createdAt", created_at)?;
    ensure_timestamp("updatedAt", updated_at)?;

    if tags.len() > MAX_TAGS_PER_CARD {
        return Err(AppError::Invalid(format!(
            "a card cannot contain more than {MAX_TAGS_PER_CARD} tags"
        )));
    }
    let mut seen = HashSet::new();
    for tag in tags {
        ensure_normalized("tag", tag)?;
        ensure_length("tag", tag, 1, MAX_TAG_LENGTH)?;
        let key = tag.to_lowercase();
        if !seen.insert(key) {
            return Err(AppError::Invalid(
                "tags must be unique without regard to case".into(),
            ));
        }
    }
    Ok(())
}

impl Skill {
    pub fn validate(&self) -> AppResult<()> {
        if self.kind != CardKind::Skill {
            return Err(AppError::Invalid("Skill.kind must be skill".into()));
        }
        validate_common(
            &self.id,
            &self.title,
            &self.description,
            &self.tags,
            &self.created_at,
            &self.updated_at,
        )?;
        ensure_length("prompt", &self.prompt, 1, MAX_CONTENT_LENGTH)?;
        ensure_length("installNotes", &self.install_notes, 0, MAX_CONTENT_LENGTH)
    }
}

impl McpTool {
    pub fn validate(&self) -> AppResult<()> {
        if self.kind != CardKind::Mcp {
            return Err(AppError::Invalid("McpTool.kind must be mcp".into()));
        }
        validate_common(
            &self.id,
            &self.title,
            &self.description,
            &self.tags,
            &self.created_at,
            &self.updated_at,
        )?;
        ensure_normalized("serverName", &self.server_name)?;
        ensure_length("serverName", &self.server_name, 1, MAX_TITLE_LENGTH)?;
        if is_dangerous_key(&self.server_name) {
            return Err(AppError::Invalid("serverName is unsafe".into()));
        }
        ensure_length("command", &self.command, 1, MAX_CONTENT_LENGTH)?;
        if self.args.len() > MAX_ARGS_PER_MCP {
            return Err(AppError::Invalid(format!(
                "MCP args cannot contain more than {MAX_ARGS_PER_MCP} entries"
            )));
        }
        for arg in &self.args {
            ensure_length("MCP argument", arg, 0, MAX_CONTENT_LENGTH)?;
        }
        if self.env.len() > MAX_ENV_ENTRIES_PER_MCP {
            return Err(AppError::Invalid(format!(
                "MCP env cannot contain more than {MAX_ENV_ENTRIES_PER_MCP} entries"
            )));
        }
        for (key, value) in &self.env {
            ensure_length("MCP env key", key, 1, MAX_TAG_LENGTH)?;
            ensure_length("MCP env value", value, 0, MAX_CONTENT_LENGTH)?;
            if is_dangerous_key(key) {
                return Err(AppError::Invalid(format!("unsafe MCP env key: {key}")));
            }
        }
        Ok(())
    }
}

impl LibraryState {
    pub fn validate(&self) -> AppResult<()> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(AppError::Invalid(format!(
                "unsupported schema version: {}",
                self.schema_version
            )));
        }
        if self.revision > MAX_SAFE_REVISION {
            return Err(AppError::Invalid(
                "revision exceeds the safe integer range".into(),
            ));
        }
        if self.skills.len() + self.mcps.len() > MAX_CARDS {
            return Err(AppError::Invalid(format!(
                "library cannot contain more than {MAX_CARDS} cards"
            )));
        }

        let mut ids = HashSet::new();
        for skill in &self.skills {
            skill.validate()?;
            if !ids.insert(skill.id.to_ascii_lowercase()) {
                return Err(AppError::Invalid(format!(
                    "duplicate card id: {}",
                    skill.id
                )));
            }
        }
        for mcp in &self.mcps {
            mcp.validate()?;
            if !ids.insert(mcp.id.to_ascii_lowercase()) {
                return Err(AppError::Invalid(format!("duplicate card id: {}", mcp.id)));
            }
        }
        Ok(())
    }

    pub fn validate_candidate(&self, base_revision: u64) -> AppResult<()> {
        self.validate()?;
        let expected = base_revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_REVISION)
            .ok_or_else(|| {
                AppError::Invalid("base revision cannot be incremented safely".into())
            })?;
        if self.revision != expected {
            return Err(AppError::Invalid(format!(
                "candidate revision must be {expected}"
            )));
        }
        Ok(())
    }
}

fn parse_seed_pack(raw: &str) -> AppResult<SeedPack> {
    let pack: SeedPack = serde_json::from_str(raw)
        .map_err(|error| AppError::Invalid(format!("bundled seed pack is invalid: {error}")))?;
    for skill in &pack.skills {
        skill.validate()?;
    }
    for mcp in &pack.mcps {
        mcp.validate()?;
    }
    let mut ids = HashSet::new();
    for id in pack
        .skills
        .iter()
        .map(|card| &card.id)
        .chain(pack.mcps.iter().map(|card| &card.id))
    {
        if !ids.insert(id.to_ascii_lowercase()) {
            return Err(AppError::Invalid(format!(
                "duplicate seed pack card id: {id}"
            )));
        }
    }
    Ok(pack)
}

pub fn latest_seed_pack_version() -> u32 {
    parse_seed_pack(SEED_PACK_V1_JSON)
        .expect("bundled v1 seed pack must be valid")
        .version
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeedPackMigration {
    Current,
    Applied(LibraryState),
    Deferred,
}

pub fn migrate_to_latest_seed_pack(state: &LibraryState) -> AppResult<SeedPackMigration> {
    state.validate()?;
    let legacy = parse_seed_pack(SEED_PACK_V0_JSON)?;
    let latest = parse_seed_pack(SEED_PACK_V1_JSON)?;
    let mut migrated = state.clone();

    migrated.skills.retain(|card| {
        !legacy
            .skills
            .iter()
            .any(|old| old.id == card.id && old == card)
    });
    migrated.mcps.retain(|card| {
        !legacy
            .mcps
            .iter()
            .any(|old| old.id == card.id && old == card)
    });

    let mut occupied_ids = migrated
        .skills
        .iter()
        .map(|card| card.id.to_ascii_lowercase())
        .chain(
            migrated
                .mcps
                .iter()
                .map(|card| card.id.to_ascii_lowercase()),
        )
        .collect::<HashSet<_>>();
    for skill in latest.skills {
        if occupied_ids.insert(skill.id.to_ascii_lowercase()) {
            migrated.skills.push(skill);
        }
    }
    for mcp in latest.mcps {
        if occupied_ids.insert(mcp.id.to_ascii_lowercase()) {
            migrated.mcps.push(mcp);
        }
    }

    if migrated.skills == state.skills && migrated.mcps == state.mcps {
        return Ok(SeedPackMigration::Current);
    }
    if migrated.skills.len() + migrated.mcps.len() > MAX_CARDS
        || state.revision >= MAX_SAFE_REVISION
    {
        return Ok(SeedPackMigration::Deferred);
    }
    migrated.revision = state.revision + 1;
    migrated.validate()?;
    Ok(SeedPackMigration::Applied(migrated))
}

pub fn default_library_state() -> LibraryState {
    let pack = parse_seed_pack(SEED_PACK_V1_JSON).expect("bundled v1 seed pack must be valid");
    LibraryState {
        schema_version: SCHEMA_VERSION,
        revision: 0,
        skills: pack.skills,
        mcps: pack.mcps,
        preferences: LibraryPreferences {
            manager_view: LibraryView::Skills,
            sort: SortMode::UpdatedDesc,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_state(revision: u64) -> LibraryState {
        let pack = parse_seed_pack(SEED_PACK_V0_JSON).unwrap();
        LibraryState {
            schema_version: SCHEMA_VERSION,
            revision,
            skills: pack.skills,
            mcps: pack.mcps,
            preferences: LibraryPreferences {
                manager_view: LibraryView::Skills,
                sort: SortMode::UpdatedDesc,
            },
        }
    }

    #[test]
    fn default_library_uses_exact_v1_seed_pack() {
        let pack = parse_seed_pack(SEED_PACK_V1_JSON).unwrap();
        let state = default_library_state();
        assert_eq!(pack.version, 1);
        assert_eq!(state.revision, 0);
        assert_eq!(state.skills, pack.skills);
        assert_eq!(state.mcps, pack.mcps);
        assert_eq!(state.skills.len(), 2);
        assert_eq!(state.mcps.len(), 3);
    }

    #[test]
    fn migration_preserves_modified_legacy_cards_and_is_idempotent() {
        let mut state = legacy_state(7);
        state.skills[0].favorite = !state.skills[0].favorite;
        let modified = state.skills[0].clone();

        let SeedPackMigration::Applied(migrated) = migrate_to_latest_seed_pack(&state).unwrap()
        else {
            panic!("legacy state should migrate");
        };
        assert_eq!(migrated.revision, 8);
        assert!(migrated.skills.contains(&modified));
        assert_eq!(migrated.skills.len(), 3);
        assert_eq!(migrated.mcps.len(), 3);
        assert_eq!(
            migrate_to_latest_seed_pack(&migrated).unwrap(),
            SeedPackMigration::Current
        );
    }

    #[test]
    fn migration_defers_at_card_and_revision_limits() {
        let mut full = legacy_state(3);
        let template = full.skills[0].clone();
        full.skills = (0..MAX_CARDS)
            .map(|_| {
                let mut card = template.clone();
                card.id = Uuid::new_v4().to_string();
                card
            })
            .collect();
        full.mcps.clear();
        assert_eq!(
            migrate_to_latest_seed_pack(&full).unwrap(),
            SeedPackMigration::Deferred
        );

        let mut max_revision = legacy_state(MAX_SAFE_REVISION);
        max_revision.skills.clear();
        max_revision.mcps.clear();
        assert_eq!(
            migrate_to_latest_seed_pack(&max_revision).unwrap(),
            SeedPackMigration::Deferred
        );
    }
}
