use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Map, Value as JsonValue};
use toml_edit::{value, Array, DocumentMut, Item, Table};

use super::{
    error::{ConfigError, ConfigErrorCode, ConfigResult},
    ConfigChangeAction, ConfigPreviewChange, PreviewValue,
};

const CLAUDE_MODEL_KEYS: &[&str] = &[
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexDesiredConfig {
    pub provider_id: String,
    pub provider_name: String,
    pub base_url: String,
    pub wire_api: String,
    pub model: String,
    pub auth_command: String,
    #[serde(default)]
    pub auth_args: Vec<String>,
    #[serde(default)]
    pub allow_replace_existing_provider: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeDesiredConfig {
    pub base_url: String,
    pub api_key_helper: String,
    #[serde(default)]
    pub models: BTreeMap<String, String>,
    #[serde(default)]
    pub remove_plaintext_auth_token: bool,
    #[serde(default)]
    pub allow_replace_existing_values: bool,
}

pub(crate) struct MergeResult {
    pub bytes: Vec<u8>,
    pub changes: Vec<ConfigPreviewChange>,
    pub warnings: Vec<String>,
}

pub(crate) fn merge_codex(
    source: &[u8],
    desired: &CodexDesiredConfig,
) -> ConfigResult<MergeResult> {
    validate_identifier("provider id", &desired.provider_id)?;
    validate_public_text("provider name", &desired.provider_name)?;
    validate_base_url(&desired.base_url)?;
    validate_public_text("wire API", &desired.wire_api)?;
    validate_public_text("model", &desired.model)?;
    validate_helper_command(&desired.auth_command)?;
    validate_helper_args(&desired.auth_args)?;

    let text = std::str::from_utf8(source).map_err(|_| {
        ConfigError::new(
            ConfigErrorCode::ConfigInvalid,
            "Codex configuration must be UTF-8",
        )
    })?;
    let mut document = if text.trim().is_empty() {
        DocumentMut::new()
    } else {
        text.parse::<DocumentMut>().map_err(|_| {
            ConfigError::new(
                ConfigErrorCode::ConfigInvalid,
                "Codex configuration is not valid TOML",
            )
        })?
    };

    if document.get("model_providers").is_some() && !document["model_providers"].is_table() {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "Codex model_providers setting is not a table",
        ));
    }

    let existing_provider = document
        .get("model_providers")
        .and_then(Item::as_table)
        .and_then(|providers| providers.get(&desired.provider_id));
    let replaces_provider =
        existing_provider.is_some() && !provider_matches(existing_provider, desired);
    if replaces_provider && !desired.allow_replace_existing_provider {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "the Codex provider id is already managed by another configuration",
        ));
    }

    let mut changes = Vec::new();
    set_toml_string(
        &mut document["model_provider"],
        "model_provider",
        &desired.provider_id,
        &mut changes,
        false,
    );
    set_toml_string(
        &mut document["model"],
        "model",
        &desired.model,
        &mut changes,
        false,
    );
    if document
        .get("model_providers")
        .and_then(Item::as_table)
        .is_none()
    {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .expect("model_providers was initialized as a table");
    if providers
        .get(&desired.provider_id)
        .and_then(Item::as_table)
        .is_none()
    {
        providers.insert(&desired.provider_id, Item::Table(Table::new()));
    }
    let provider = providers[&desired.provider_id]
        .as_table_mut()
        .expect("provider was initialized as a table");
    let prefix = format!("model_providers.{}", desired.provider_id);
    set_toml_string(
        &mut provider["name"],
        &format!("{prefix}.name"),
        &desired.provider_name,
        &mut changes,
        false,
    );
    set_toml_string(
        &mut provider["base_url"],
        &format!("{prefix}.base_url"),
        &desired.base_url,
        &mut changes,
        true,
    );
    set_toml_string(
        &mut provider["wire_api"],
        &format!("{prefix}.wire_api"),
        &desired.wire_api,
        &mut changes,
        false,
    );
    remove_toml_item(
        provider,
        "requires_openai_auth",
        &format!("{prefix}.requires_openai_auth"),
        &mut changes,
    );
    if provider.get("auth").and_then(Item::as_table).is_none() {
        provider.insert("auth", Item::Table(Table::new()));
    }
    let auth = provider["auth"]
        .as_table_mut()
        .expect("auth was initialized as a table");
    set_toml_redacted_string(
        &mut auth["command"],
        &format!("{prefix}.auth.command"),
        &desired.auth_command,
        &mut changes,
    );
    set_toml_array(
        &mut auth["args"],
        &format!("{prefix}.auth.args"),
        &desired.auth_args,
        &mut changes,
    );

    Ok(MergeResult {
        bytes: document.to_string().into_bytes(),
        changes,
        warnings: if replaces_provider {
            vec!["An existing Codex provider definition will be replaced.".into()]
        } else {
            Vec::new()
        },
    })
}

pub(crate) fn merge_claude(
    source: &[u8],
    desired: &ClaudeDesiredConfig,
) -> ConfigResult<MergeResult> {
    validate_base_url(&desired.base_url)?;
    if desired.api_key_helper.trim().is_empty() || desired.api_key_helper.contains(['\r', '\n']) {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            "Claude apiKeyHelper is invalid",
        ));
    }
    for (key, model) in &desired.models {
        if !CLAUDE_MODEL_KEYS.contains(&key.as_str()) {
            return Err(ConfigError::new(
                ConfigErrorCode::InvalidInput,
                "Claude model mapping contains an unsupported key",
            ));
        }
        validate_public_text("Claude model", model)?;
    }

    let mut root: JsonValue = if source.iter().all(u8::is_ascii_whitespace) {
        JsonValue::Object(Map::new())
    } else {
        serde_json::from_slice(source).map_err(|_| {
            ConfigError::new(
                ConfigErrorCode::ConfigInvalid,
                "Claude configuration is not valid JSON",
            )
        })?
    };
    let object = root.as_object_mut().ok_or_else(|| {
        ConfigError::new(
            ConfigErrorCode::ConfigInvalid,
            "Claude configuration root must be an object",
        )
    })?;
    if !desired.allow_replace_existing_values {
        ensure_json_compatible(object.get("apiKeyHelper"), &desired.api_key_helper)?;
        if let Some(env) = object.get("env").and_then(JsonValue::as_object) {
            ensure_json_compatible(env.get("ANTHROPIC_BASE_URL"), &desired.base_url)?;
            for (key, model) in &desired.models {
                ensure_json_compatible(env.get(key), model)?;
            }
        }
    }

    let mut changes = Vec::new();
    set_json_string(
        object,
        "apiKeyHelper",
        &desired.api_key_helper,
        &mut changes,
        true,
    );
    let env = object
        .entry("env")
        .or_insert_with(|| JsonValue::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            ConfigError::new(
                ConfigErrorCode::ConfigConflict,
                "Claude env setting is not an object",
            )
        })?;
    set_json_string(
        env,
        "ANTHROPIC_BASE_URL",
        &desired.base_url,
        &mut changes,
        true,
    );
    for (key, model) in &desired.models {
        set_json_string(env, key, model, &mut changes, false);
    }
    let mut warnings = if source.is_empty() {
        Vec::new()
    } else {
        vec!["Claude JSON formatting may be normalized while unknown fields are preserved.".into()]
    };
    if desired.remove_plaintext_auth_token {
        if env.remove("ANTHROPIC_AUTH_TOKEN").is_some() {
            changes.push(ConfigPreviewChange {
                key: "ANTHROPIC_AUTH_TOKEN".into(),
                action: ConfigChangeAction::Remove,
                before: PreviewValue::Redacted,
                after: PreviewValue::Absent,
            });
            warnings.push(
                "The plaintext Claude auth token will be removed after an encrypted backup is created."
                    .into(),
            );
        }
    } else if env.contains_key("ANTHROPIC_AUTH_TOKEN") {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "Claude contains a plaintext auth token that must be explicitly removed",
        ));
    }

    let mut bytes = serde_json::to_vec_pretty(&root).map_err(|error| {
        ConfigError::new(
            ConfigErrorCode::ConfigInvalid,
            format!("cannot serialize Claude configuration: {error}"),
        )
    })?;
    bytes.push(b'\n');
    Ok(MergeResult {
        bytes,
        changes,
        warnings,
    })
}

pub(crate) fn is_configured_for_netapi(
    target: super::CliConfigTarget,
    bytes: &[u8],
    identity: &super::NetapiConfigIdentity,
) -> ConfigResult<bool> {
    validate_base_url(&identity.base_url)?;
    validate_identifier("provider id", &identity.codex_provider_id)?;
    validate_helper_command(&identity.codex_auth_command)?;
    validate_helper_args(&identity.codex_auth_args)?;
    match target {
        super::CliConfigTarget::Codex => {
            let text = std::str::from_utf8(bytes).map_err(|_| {
                ConfigError::new(ConfigErrorCode::ConfigInvalid, "Codex config is not UTF-8")
            })?;
            let document = text.parse::<DocumentMut>().map_err(|_| {
                ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Codex config is invalid TOML",
                )
            })?;
            let active = document
                .get("model_provider")
                .and_then(Item::as_value)
                .and_then(toml_edit::Value::as_str);
            let provider = document
                .get("model_providers")
                .and_then(Item::as_table)
                .and_then(|providers| providers.get(&identity.codex_provider_id))
                .and_then(Item::as_table);
            let auth = provider
                .and_then(|table| table.get("auth"))
                .and_then(Item::as_table);
            Ok(active == Some(identity.codex_provider_id.as_str())
                && provider.and_then(|table| toml_string(table.get("base_url")))
                    == Some(identity.base_url.as_str())
                && auth.and_then(|table| toml_string(table.get("command")))
                    == Some(identity.codex_auth_command.as_str())
                && auth
                    .and_then(|table| toml_array_strings(table.get("args")))
                    .is_some_and(|args| args.as_slice() == identity.codex_auth_args.as_slice()))
        }
        super::CliConfigTarget::Claude => {
            let root: JsonValue = serde_json::from_slice(bytes).map_err(|_| {
                ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Claude config is invalid JSON",
                )
            })?;
            let object = root.as_object().ok_or_else(|| {
                ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Claude config root must be an object",
                )
            })?;
            let env = object.get("env").and_then(JsonValue::as_object);
            Ok(object.get("apiKeyHelper").and_then(JsonValue::as_str)
                == Some(identity.claude_api_key_helper.as_str())
                && env
                    .and_then(|values| values.get("ANTHROPIC_BASE_URL"))
                    .and_then(JsonValue::as_str)
                    == Some(identity.base_url.as_str())
                && !env.is_some_and(|values| values.contains_key("ANTHROPIC_AUTH_TOKEN")))
        }
    }
}

pub(crate) fn validate_config_bytes(
    target: super::CliConfigTarget,
    bytes: &[u8],
) -> ConfigResult<()> {
    match target {
        super::CliConfigTarget::Codex => {
            let text = std::str::from_utf8(bytes).map_err(|_| {
                ConfigError::new(ConfigErrorCode::ConfigInvalid, "Codex config is not UTF-8")
            })?;
            text.parse::<DocumentMut>().map_err(|_| {
                ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Codex config is invalid TOML",
                )
            })?;
        }
        super::CliConfigTarget::Claude => {
            let value: JsonValue = serde_json::from_slice(bytes).map_err(|_| {
                ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Claude config is invalid JSON",
                )
            })?;
            if !value.is_object() {
                return Err(ConfigError::new(
                    ConfigErrorCode::ConfigInvalid,
                    "Claude config root must be an object",
                ));
            }
        }
    }
    Ok(())
}

fn provider_matches(existing: Option<&Item>, desired: &CodexDesiredConfig) -> bool {
    let Some(table) = existing.and_then(Item::as_table) else {
        return false;
    };
    toml_string(table.get("name")) == Some(desired.provider_name.as_str())
        && toml_string(table.get("base_url")) == Some(desired.base_url.as_str())
        && toml_string(table.get("wire_api")) == Some(desired.wire_api.as_str())
        && table.get("requires_openai_auth").is_none()
        && table
            .get("auth")
            .and_then(Item::as_table)
            .and_then(|auth| toml_string(auth.get("command")))
            == Some(desired.auth_command.as_str())
        && table
            .get("auth")
            .and_then(Item::as_table)
            .and_then(|auth| toml_array_strings(auth.get("args")))
            .is_some_and(|args| args.as_slice() == desired.auth_args.as_slice())
}

fn toml_string(item: Option<&Item>) -> Option<&str> {
    item.and_then(Item::as_value)
        .and_then(toml_edit::Value::as_str)
}

fn toml_array_strings(item: Option<&Item>) -> Option<Vec<String>> {
    item.and_then(Item::as_value)
        .and_then(toml_edit::Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(toml_edit::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
}

fn set_toml_string(
    item: &mut Item,
    key: &str,
    desired: &str,
    changes: &mut Vec<ConfigPreviewChange>,
    redact_before: bool,
) {
    let before = item.as_value().and_then(toml_edit::Value::as_str);
    if before == Some(desired) {
        return;
    }
    changes.push(change(
        key,
        before.map(|value| preview_existing(value, redact_before)),
        PreviewValue::Public(desired.to_owned()),
    ));
    *item = value(desired);
}

fn set_toml_redacted_string(
    item: &mut Item,
    key: &str,
    desired: &str,
    changes: &mut Vec<ConfigPreviewChange>,
) {
    if item.as_value().and_then(toml_edit::Value::as_str) == Some(desired) {
        return;
    }
    changes.push(ConfigPreviewChange {
        key: key.to_owned(),
        action: if item.is_none() {
            ConfigChangeAction::Add
        } else {
            ConfigChangeAction::Update
        },
        before: if item.is_none() {
            PreviewValue::Absent
        } else {
            PreviewValue::Redacted
        },
        after: PreviewValue::Redacted,
    });
    *item = value(desired);
}

fn remove_toml_item(
    table: &mut Table,
    item_name: &str,
    key: &str,
    changes: &mut Vec<ConfigPreviewChange>,
) {
    let Some(before) = table.remove(item_name) else {
        return;
    };
    changes.push(ConfigPreviewChange {
        key: key.to_owned(),
        action: ConfigChangeAction::Remove,
        before: before
            .as_value()
            .and_then(toml_edit::Value::as_bool)
            .map(|value| PreviewValue::Public(value.to_string()))
            .unwrap_or(PreviewValue::Redacted),
        after: PreviewValue::Absent,
    });
}

fn set_toml_array(
    item: &mut Item,
    key: &str,
    desired: &[String],
    changes: &mut Vec<ConfigPreviewChange>,
) {
    if toml_array_strings(Some(item)).as_deref() == Some(desired) {
        return;
    }
    changes.push(ConfigPreviewChange {
        key: key.to_owned(),
        action: if item.is_none() {
            ConfigChangeAction::Add
        } else {
            ConfigChangeAction::Update
        },
        before: if item.is_none() {
            PreviewValue::Absent
        } else {
            PreviewValue::Redacted
        },
        after: PreviewValue::Redacted,
    });
    let mut array = Array::new();
    for argument in desired {
        array.push(argument.as_str());
    }
    *item = value(array);
}

fn set_json_string(
    object: &mut Map<String, JsonValue>,
    key: &str,
    desired: &str,
    changes: &mut Vec<ConfigPreviewChange>,
    redact_before: bool,
) {
    let before = object.get(key).and_then(JsonValue::as_str);
    if before == Some(desired) {
        return;
    }
    changes.push(change(
        key,
        before.map(|value| preview_existing(value, redact_before)),
        if key == "apiKeyHelper" {
            PreviewValue::Redacted
        } else {
            PreviewValue::Public(desired.to_owned())
        },
    ));
    object.insert(key.to_owned(), JsonValue::String(desired.to_owned()));
}

fn change(key: &str, before: Option<PreviewValue>, after: PreviewValue) -> ConfigPreviewChange {
    ConfigPreviewChange {
        key: key.to_owned(),
        action: if before.is_some() {
            ConfigChangeAction::Update
        } else {
            ConfigChangeAction::Add
        },
        before: before.unwrap_or(PreviewValue::Absent),
        after,
    }
}

fn preview_existing(value: &str, redact: bool) -> PreviewValue {
    if redact || value.len() > 120 || value.chars().any(char::is_control) {
        PreviewValue::Redacted
    } else {
        PreviewValue::Public(value.to_owned())
    }
}

fn ensure_json_compatible(existing: Option<&JsonValue>, desired: &str) -> ConfigResult<()> {
    if existing.is_none() || existing.and_then(JsonValue::as_str) == Some(desired) {
        Ok(())
    } else {
        Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "Claude already contains a conflicting managed value",
        ))
    }
}

fn validate_identifier(label: &str, value: &str) -> ConfigResult<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            format!("{label} is invalid"),
        ));
    }
    Ok(())
}

fn validate_public_text(label: &str, value: &str) -> ConfigResult<()> {
    if value.trim().is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            format!("{label} is invalid"),
        ));
    }
    Ok(())
}

fn validate_base_url(value: &str) -> ConfigResult<()> {
    validate_public_text("base URL", value)?;
    let remainder = value.strip_prefix("https://").ok_or_else(|| {
        ConfigError::new(ConfigErrorCode::InvalidInput, "base URL must use HTTPS")
    })?;
    if remainder.is_empty()
        || remainder.contains(['@', '?', '#'])
        || remainder.starts_with('/')
        || remainder.contains(char::is_whitespace)
    {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            "base URL contains credentials, a query, or an invalid host",
        ));
    }
    Ok(())
}

fn validate_helper_command(value: &str) -> ConfigResult<()> {
    if value.trim().is_empty()
        || value.len() > 512
        || value.chars().any(char::is_control)
        || !value.to_ascii_lowercase().ends_with(".exe")
    {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            "Codex auth helper command must be a Windows executable path",
        ));
    }
    Ok(())
}

fn validate_helper_args(values: &[String]) -> ConfigResult<()> {
    if values.len() > 16 {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidInput,
            "Codex auth helper has too many arguments",
        ));
    }
    for value in values {
        let lower = value.to_ascii_lowercase();
        if value.is_empty()
            || value.len() > 128
            || value.chars().any(char::is_control)
            || ["token", "secret", "password", "bearer", "api_key", "apikey"]
                .iter()
                .any(|needle| lower.contains(needle))
        {
            return Err(ConfigError::new(
                ConfigErrorCode::InvalidInput,
                "Codex auth helper arguments must not contain credentials",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_merge_preserves_comments_and_unknown_keys() {
        let source = br#"# keep this comment
approval_policy = "never"

[model_providers.other]
name = "Other"
base_url = "https://other.example/v1"

[model_providers.netapi]
requires_openai_auth = true
"#;
        let result = merge_codex(
            source,
            &CodexDesiredConfig {
                provider_id: "netapi".into(),
                provider_name: "NetAPI".into(),
                base_url: "https://api.example/v1".into(),
                wire_api: "responses".into(),
                model: "model-a".into(),
                auth_command: r"C:\Program Files\Jacobe\jacobe-credential-helper.exe".into(),
                auth_args: vec!["codex".into(), "netapi".into()],
                allow_replace_existing_provider: true,
            },
        )
        .unwrap();
        let output = String::from_utf8(result.bytes).unwrap();
        assert!(output.contains("# keep this comment"));
        assert!(output.contains("approval_policy = \"never\""));
        assert!(output.contains("[model_providers.other]"));
        assert!(output.contains("[model_providers.netapi]"));
        assert!(output.contains("[model_providers.netapi.auth]"));
        assert!(output.contains("jacobe-credential-helper.exe"));
        assert!(!output.contains("requires_openai_auth"));
        let preview = serde_json::to_string(&result.changes).unwrap();
        assert!(!preview.contains("jacobe-credential-helper.exe"));
        assert!(preview.contains("requires_openai_auth"));
        assert!(preview.contains("remove"));
    }

    #[test]
    fn claude_merge_redacts_and_removes_plaintext_token() {
        let source = br#"{"theme":"dark","env":{"ANTHROPIC_AUTH_TOKEN":"canary-secret"}}"#;
        let result = merge_claude(
            source,
            &ClaudeDesiredConfig {
                base_url: "https://api.example".into(),
                api_key_helper: r#""C:\Program Files\Jacobe\helper.exe" netapi"#.into(),
                models: BTreeMap::from([("ANTHROPIC_MODEL".into(), "model-a".into())]),
                remove_plaintext_auth_token: true,
                allow_replace_existing_values: false,
            },
        )
        .unwrap();
        let output = String::from_utf8(result.bytes).unwrap();
        assert!(output.contains("\"theme\": \"dark\""));
        assert!(!output.contains("canary-secret"));
        let preview = serde_json::to_string(&result.changes).unwrap();
        assert!(!preview.contains("canary-secret"));
        assert!(preview.contains("redacted"));
    }

    #[test]
    fn rejects_insecure_or_credentialed_base_urls() {
        for value in [
            "http://api.example",
            "https://user@api.example",
            "https://api.example?q=1",
        ] {
            assert!(validate_base_url(value).is_err());
        }
    }
}
