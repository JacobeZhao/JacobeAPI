use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use crate::{
    account::{
        AccountError, AccountSessionView, AccountSummarySnapshot, DashboardSnapshot,
        LeaderboardQuery, LeaderboardSnapshot, LoginRequest,
    },
    cli_config::{
        ClaudeDesiredConfig, CliConfigStatus, CliConfigTarget, CodexDesiredConfig,
        ConfigApplyReceipt, ConfigBackupSummary, ConfigError, ConfigErrorCode, ConfigPlanPreview,
        NetapiConfigIdentity,
    },
    domain::LibraryState,
    error::{CommandError, ErrorCode},
    state::AppState,
    windows,
};

const MAX_TEXT_FILE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTextFileRequest {
    pub content: String,
    pub default_name: String,
    pub extension: SaveExtension,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveExtension {
    Json,
    Md,
}

impl SaveExtension {
    fn value(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Md => "md",
        }
    }

    fn filter_name(self) -> &'static str {
        match self {
            Self::Json => "JSON",
            Self::Md => "Markdown",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedTextFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveFileStatus {
    Saved,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub autostart_enabled: bool,
    pub orb_visible: bool,
    pub always_on_top: bool,
}

#[tauri::command]
pub fn get_library(state: State<'_, AppState>) -> Result<LibraryState, CommandError> {
    state.library.load().map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn commit_library(
    app: AppHandle,
    state: State<'_, AppState>,
    base_revision: u64,
    candidate: LibraryState,
) -> Result<LibraryState, CommandError> {
    let access = state.account.library_access().map_err(|_| CommandError {
        code: ErrorCode::Unknown,
        message: "账户状态暂时不可用，请重启应用。".into(),
        state: None,
        details: None,
    })?;
    let committed = state
        .library
        .commit_with_access(base_revision, candidate, access.access())
        .map_err(CommandError::from)?;
    drop(access);
    let _ = app.emit("library-updated", &committed);
    Ok(committed)
}

#[tauri::command]
pub fn show_manager(app: AppHandle, destination: Option<String>) -> Result<(), String> {
    let destination = destination.unwrap_or_else(|| "library".into());
    if !matches!(destination.as_str(), "library" | "account") {
        return Err("unknown manager destination".into());
    }
    if destination == "library" {
        return windows::show_manager_home(&app);
    }
    windows::show_manager(&app)?;
    app.emit_to(windows::MANAGER_LABEL, "manager-navigate", destination)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn account_error(error: AccountError) -> String {
    use crate::netapi::NetApiError;
    match error {
        AccountError::Remote(NetApiError::InvalidCredentials) => "账号或密码不正确。".into(),
        AccountError::Remote(NetApiError::Unauthorized) | AccountError::Unauthenticated => {
            "登录已过期，请重新登录。".into()
        }
        AccountError::Remote(NetApiError::Forbidden) => "当前账户没有访问权限。".into(),
        AccountError::Remote(NetApiError::RateLimited) => "请求过于频繁，请稍后重试。".into(),
        AccountError::Remote(NetApiError::Timeout | NetApiError::Unavailable) => {
            "netapi.cc 暂时无法连接，请检查网络后重试。".into()
        }
        AccountError::Remote(NetApiError::InvalidResponse(_)) => {
            "netapi.cc 返回了无法识别的数据。".into()
        }
        AccountError::Credential(_) => "安全凭据存储暂时不可用。".into(),
        AccountError::State(_) => "账户状态暂时不可用，请重启应用。".into(),
    }
}

#[tauri::command]
pub fn get_account_session(state: State<'_, AppState>) -> Result<AccountSessionView, String> {
    state.account.get_session().map_err(account_error)
}

#[tauri::command]
pub fn login_netapi(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LoginRequest,
) -> Result<AccountSessionView, String> {
    let session = state.account.login(&request).map_err(account_error)?;
    let _ = app.emit("account-session-updated", &session);
    Ok(session)
}

#[tauri::command]
pub fn logout_netapi(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.account.logout().map_err(account_error)?;
    let session = state.account.get_session().map_err(account_error)?;
    let _ = app.emit("account-session-updated", &session);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_dashboard(
    app: AppHandle,
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<DashboardSnapshot, String> {
    match state.account.get_dashboard(force_refresh.unwrap_or(false)) {
        Ok(dashboard) => {
            let _ = app.emit("dashboard-updated", &dashboard);
            Ok(dashboard)
        }
        Err(error) => {
            emit_expired_session(&app, &state);
            Err(account_error(error))
        }
    }
}

fn emit_expired_session(app: &AppHandle, state: &State<'_, AppState>) {
    if let Ok(session) = state.account.get_session() {
        if session.status == crate::account::SessionStatus::Expired {
            let _ = app.emit("account-session-updated", session);
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_account_summary(
    app: AppHandle,
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<AccountSummarySnapshot, String> {
    match state.account.get_summary(force_refresh.unwrap_or(false)) {
        Ok(summary) => {
            let _ = app.emit("account-summary-updated", &summary);
            Ok(summary)
        }
        Err(error) => {
            emit_expired_session(&app, &state);
            Err(account_error(error))
        }
    }
}

#[tauri::command]
pub fn get_leaderboard(
    app: AppHandle,
    state: State<'_, AppState>,
    query: Option<LeaderboardQuery>,
) -> Result<LeaderboardSnapshot, String> {
    match state.account.get_leaderboard(&query.unwrap_or_default()) {
        Ok(leaderboard) => {
            let _ = app.emit("leaderboard-updated", &leaderboard);
            Ok(leaderboard)
        }
        Err(error) => {
            emit_expired_session(&app, &state);
            Err(account_error(error))
        }
    }
}

fn cli_config_error(error: ConfigError) -> String {
    match error.code {
        ConfigErrorCode::InvalidInput => "配置请求不正确，请重新生成预览。".into(),
        ConfigErrorCode::UnsupportedPath | ConfigErrorCode::UnsafePath => {
            "配置文件路径不受支持，为保护现有文件已停止操作。".into()
        }
        ConfigErrorCode::ConfigMissing => "没有找到对应的配置文件。".into(),
        ConfigErrorCode::ConfigInvalid => "现有配置无法解析，不会覆盖该文件。".into(),
        ConfigErrorCode::ConfigConflict => "配置已被其他程序修改，请重新生成预览。".into(),
        ConfigErrorCode::ExistingConfigConflict => {
            "现有配置结构与 JacobeAPI 不兼容，未进行任何修改。".into()
        }
        ConfigErrorCode::ConcurrentModification => "配置在预览后发生变化，请重新生成预览。".into(),
        ConfigErrorCode::PlanMissing | ConfigErrorCode::PlanExpired => {
            "配置预览已失效，请重新生成。".into()
        }
        ConfigErrorCode::BackupInvalid => "配置备份不存在或已经损坏。".into(),
        ConfigErrorCode::ProtectionFailed => "Windows 无法保护或读取配置备份。".into(),
        ConfigErrorCode::Io => "配置文件操作失败，原配置已尽可能保持不变。".into(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCommandError {
    code: &'static str,
    message: String,
}

impl CliCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn structured_cli_config_error(error: ConfigError) -> CliCommandError {
    let code = match error.code {
        ConfigErrorCode::ExistingConfigConflict => "EXISTING_CONFIG_CONFLICT",
        ConfigErrorCode::ConcurrentModification => "CONFIG_CHANGED",
        ConfigErrorCode::ConfigConflict => "CONFIG_CONFLICT",
        ConfigErrorCode::InvalidInput => "INVALID_INPUT",
        ConfigErrorCode::UnsupportedPath | ConfigErrorCode::UnsafePath => "UNSAFE_PATH",
        ConfigErrorCode::ConfigMissing => "CONFIG_MISSING",
        ConfigErrorCode::ConfigInvalid => "CONFIG_INVALID",
        ConfigErrorCode::PlanMissing => "PLAN_MISSING",
        ConfigErrorCode::PlanExpired => "PLAN_EXPIRED",
        ConfigErrorCode::BackupInvalid => "BACKUP_INVALID",
        ConfigErrorCode::ProtectionFailed => "PROTECTION_FAILED",
        ConfigErrorCode::Io => "IO_ERROR",
    };
    CliCommandError::new(code, cli_config_error(error))
}

fn cli_engine(state: &AppState) -> Result<&crate::cli_config::ConfigEngine, String> {
    state
        .cli_config
        .as_ref()
        .ok_or_else(|| "当前系统无法安全访问 Codex 或 Claude Code 配置目录。".into())
}

fn netapi_config_identity() -> NetapiConfigIdentity {
    let helper = std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| fallback_helper_name().into());
    NetapiConfigIdentity {
        base_url: "https://netapi.cc".into(),
        codex_provider_id: "netapi-demo".into(),
        codex_auth_command: helper.clone(),
        codex_auth_args: vec![
            "credential-helper".into(),
            "codex".into(),
            "netapi-demo".into(),
        ],
        claude_api_key_helper: format!(
            "{} credential-helper claude netapi-demo",
            quote_helper_for_shell(&helper)
        ),
    }
}

#[cfg(windows)]
fn fallback_helper_name() -> &'static str {
    "jacobe-skills.exe"
}

#[cfg(not(windows))]
fn fallback_helper_name() -> &'static str {
    "jacobe-skills"
}

#[cfg(windows)]
fn quote_helper_for_shell(value: &str) -> String {
    // Double quotes cannot occur in a valid Windows path.
    format!("\"{value}\"")
}

#[cfg(not(windows))]
fn quote_helper_for_shell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn require_demo_mock_session(session: &AccountSessionView) -> Result<(), String> {
    let is_demo = session.status == crate::account::SessionStatus::SignedIn
        && session.source == crate::account::DataSource::Mock
        && session
            .user
            .as_ref()
            .and_then(|user| user.email.as_deref())
            .is_some_and(|email| {
                email.eq_ignore_ascii_case(crate::netapi::MOCK_ACCOUNT_IDENTIFIER)
            });
    is_demo
        .then_some(())
        .ok_or_else(|| "一键配置目前仅对已登录的本机演示账户开放。".into())
}

fn add_demo_warning(preview: &mut ConfigPlanPreview) {
    preview.warnings.insert(
        0,
        "这是仅供本机演示的模拟配置，不能用于正式账户或生产调用。".into(),
    );
}

#[tauri::command]
pub fn scan_cli_configs(state: State<'_, AppState>) -> Result<Vec<CliConfigStatus>, String> {
    Ok(cli_engine(&state)?.scan(&netapi_config_identity()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_cli_config(
    state: State<'_, AppState>,
    target: CliConfigTarget,
) -> Result<ConfigPlanPreview, CliCommandError> {
    let session = state
        .account
        .get_session()
        .map_err(|error| CliCommandError::new("ACCOUNT_UNAVAILABLE", account_error(error)))?;
    require_demo_mock_session(&session)
        .map_err(|message| CliCommandError::new("DEMO_LOGIN_REQUIRED", message))?;
    let engine = cli_engine(&state)
        .map_err(|message| CliCommandError::new("CONFIG_UNAVAILABLE", message))?;
    let identity = netapi_config_identity();
    let mut preview = match target {
        CliConfigTarget::Codex => engine.plan_codex(CodexDesiredConfig {
            provider_id: identity.codex_provider_id,
            provider_name: "netapi.cc Demo (Mock only)".into(),
            base_url: identity.base_url,
            wire_api: "responses".into(),
            model: "jacobe-demo-codex".into(),
            auth_command: identity.codex_auth_command,
            auth_args: identity.codex_auth_args,
            allow_replace_existing_provider: false,
        }),
        CliConfigTarget::Claude => engine.plan_claude(ClaudeDesiredConfig {
            base_url: identity.base_url,
            api_key_helper: identity.claude_api_key_helper,
            models: BTreeMap::from([("ANTHROPIC_MODEL".into(), "jacobe-demo-claude".into())]),
            remove_plaintext_auth_token: true,
            allow_replace_existing_values: true,
        }),
    }
    .map_err(structured_cli_config_error)?;
    add_demo_warning(&mut preview);
    Ok(preview)
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_cli_config(
    app: AppHandle,
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<ConfigApplyReceipt, CliCommandError> {
    let session = state
        .account
        .get_session()
        .map_err(|error| CliCommandError::new("ACCOUNT_UNAVAILABLE", account_error(error)))?;
    require_demo_mock_session(&session)
        .map_err(|message| CliCommandError::new("DEMO_LOGIN_REQUIRED", message))?;
    let result = cli_engine(&state)
        .map_err(|message| CliCommandError::new("CONFIG_UNAVAILABLE", message))?
        .apply(&plan_id)
        .map_err(structured_cli_config_error)?;
    let _ = app.emit(
        "cli-config-updated",
        serde_json::json!({ "kind": "applied", "result": &result }),
    );
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_cli_config_backups(
    state: State<'_, AppState>,
    target: CliConfigTarget,
) -> Result<Vec<ConfigBackupSummary>, String> {
    Ok(cli_engine(&state)?
        .list_backups()
        .map_err(cli_config_error)?
        .into_iter()
        .filter(|backup| backup.target == target)
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRestoreResult {
    target: CliConfigTarget,
    path: String,
    restored_at: String,
    restart_required: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn restore_cli_config_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    backup_id: String,
) -> Result<CliRestoreResult, String> {
    let receipt = cli_engine(&state)?
        .restore(&backup_id)
        .map_err(cli_config_error)?;
    let result = CliRestoreResult {
        target: receipt.target,
        path: receipt.path,
        restored_at: receipt.applied_at,
        restart_required: receipt.restart_required,
    };
    let _ = app.emit(
        "cli-config-updated",
        serde_json::json!({ "kind": "restored", "result": &result }),
    );
    Ok(result)
}

#[tauri::command]
pub fn hide_manager(app: AppHandle) -> Result<(), String> {
    windows::hide_manager(&app)
}

#[tauri::command]
pub fn begin_orb_drag(app: AppHandle) -> Result<(), String> {
    windows::begin_orb_drag(&app)
}

#[tauri::command]
pub fn toggle_quick_panel(app: AppHandle) -> Result<(), String> {
    windows::toggle_quick_panel(&app)
}

#[tauri::command]
pub fn orb_drag_ended(app: AppHandle) -> Result<(), String> {
    windows::snap_orb_window(&app)
}

#[tauri::command]
pub fn hide_quick_panel(app: AppHandle) -> Result<(), String> {
    windows::hide_quick_panel(&app)
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() > MAX_TEXT_FILE_BYTES {
        return Err("clipboard content exceeds the 4 MiB limit".into());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pick_json_file(app: AppHandle) -> Result<Option<SelectedTextFile>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "only local JSON files can be imported".to_string())?;
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("the selected file must have a .json extension".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("cannot inspect file: {error}"))?;
    if metadata.len() > MAX_TEXT_FILE_BYTES as u64 {
        return Err("JSON file exceeds the 4 MiB limit".into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("cannot read JSON file: {error}"))?;
    if bytes.len() > MAX_TEXT_FILE_BYTES {
        return Err("JSON file exceeds the 4 MiB limit".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "JSON file must be UTF-8".to_string())?;
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|error| format!("invalid JSON file: {error}"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "file name must be UTF-8".to_string())?
        .to_owned();
    Ok(Some(SelectedTextFile { name, text }))
}

fn is_plain_file_name(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value)
            .file_name()
            .is_some_and(|name| name == value)
        && !value.contains('/')
        && !value.contains('\\')
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_text_file(
    app: AppHandle,
    request: SaveTextFileRequest,
) -> Result<SaveFileStatus, String> {
    if request.content.len() > MAX_TEXT_FILE_BYTES {
        return Err("export content exceeds the 4 MiB limit".into());
    }
    if !is_plain_file_name(&request.default_name) {
        return Err("invalid default file name".into());
    }
    let extension = request.extension.value();
    let Some(selected) = app
        .dialog()
        .file()
        .set_file_name(&request.default_name)
        .add_filter(request.extension.filter_name(), &[extension])
        .blocking_save_file()
    else {
        return Ok(SaveFileStatus::Cancelled);
    };
    let path = selected
        .into_path()
        .map_err(|_| "exports must be saved to a local file".to_string())?;
    windows::atomic_write(&path, request.content.as_bytes())
        .map_err(|error| format!("cannot save export: {error}"))?;
    Ok(SaveFileStatus::Saved)
}

pub fn autostart_enabled(app: &AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

pub fn set_autostart_enabled(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    }
    .map_err(|error| error.to_string())?;
    autostart.is_enabled().map_err(|error| error.to_string())
}

fn desktop_preferences(app: &AppHandle) -> Result<DesktopPreferences, String> {
    Ok(DesktopPreferences {
        autostart_enabled: autostart_enabled(app)?,
        orb_visible: windows::orb_visible(app)?,
        always_on_top: windows::orb_always_on_top(app)?,
    })
}

#[tauri::command]
pub fn get_desktop_preferences(app: AppHandle) -> Result<DesktopPreferences, String> {
    desktop_preferences(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<DesktopPreferences, String> {
    set_autostart_enabled(&app, enabled)?;
    desktop_preferences(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_orb_visible(app: AppHandle, visible: bool) -> Result<DesktopPreferences, String> {
    windows::set_orb_visible(&app, visible)?;
    desktop_preferences(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<DesktopPreferences, String> {
    windows::set_orb_always_on_top(&app, enabled)?;
    desktop_preferences(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account::{AccountUser, DataSource, SessionStatus};

    fn session(
        status: SessionStatus,
        source: DataSource,
        email: Option<&str>,
    ) -> AccountSessionView {
        AccountSessionView {
            status,
            source,
            user: email.map(|email| AccountUser {
                id: "test-user".into(),
                display_name: "Test User".into(),
                email: Some(email.into()),
            }),
            expires_at: None,
        }
    }

    #[test]
    fn demo_configuration_requires_exact_signed_in_mock_account() {
        assert!(require_demo_mock_session(&session(
            SessionStatus::SignedIn,
            DataSource::Mock,
            Some(crate::netapi::MOCK_ACCOUNT_IDENTIFIER),
        ))
        .is_ok());
        assert!(require_demo_mock_session(&session(
            SessionStatus::SignedOut,
            DataSource::Mock,
            Some(crate::netapi::MOCK_ACCOUNT_IDENTIFIER),
        ))
        .is_err());
        assert!(require_demo_mock_session(&session(
            SessionStatus::SignedIn,
            DataSource::Live,
            Some(crate::netapi::MOCK_ACCOUNT_IDENTIFIER),
        ))
        .is_err());
        assert!(require_demo_mock_session(&session(
            SessionStatus::SignedIn,
            DataSource::Mock,
            Some("other@example.com"),
        ))
        .is_err());
    }

    #[test]
    fn demo_identity_contains_no_gateway_secret() {
        let identity = netapi_config_identity();
        let serialized = serde_json::to_string(&serde_json::json!({
            "baseUrl": identity.base_url,
            "provider": identity.codex_provider_id,
            "command": identity.codex_auth_command,
            "args": identity.codex_auth_args,
            "claudeHelper": identity.claude_api_key_helper,
        }))
        .unwrap();
        let credential = match crate::cli_config::parse_credential_helper_args([
            "credential-helper",
            "codex",
            "netapi-demo",
        ]) {
            crate::cli_config::CredentialHelperMode::Demo(value) => value,
            _ => panic!("expected demo credential"),
        };
        assert!(!serialized.contains(credential.expose_for_stdout()));
    }

    #[cfg(windows)]
    #[test]
    fn claude_helper_quotes_windows_paths_with_spaces() {
        assert_eq!(
            quote_helper_for_shell(r"C:\Program Files\JacobeAPI\jacobe-skills.exe"),
            r#""C:\Program Files\JacobeAPI\jacobe-skills.exe""#
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn claude_helper_posix_quotes_shell_metacharacters() {
        assert_eq!(
            quote_helper_for_shell("/Applications/Jacobe's $API.app/Contents/MacOS/jacobe-skills"),
            "'/Applications/Jacobe'\"'\"'s $API.app/Contents/MacOS/jacobe-skills'"
        );
    }
}
