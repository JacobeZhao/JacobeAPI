mod credentials;

use std::{
    fmt,
    sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard},
};

use thiserror::Error;

pub use crate::netapi::{
    AccountSessionView, AccountSummarySnapshot, AccountUser, BalanceView, DashboardPeriod,
    DashboardSnapshot, DataSource, LeaderboardQuery, LeaderboardRow, LeaderboardSnapshot,
    LoginRequest, SessionStatus, TokenCount,
};
#[cfg(target_os = "macos")]
pub use credentials::MacOsCredentialStore;
#[cfg(windows)]
pub use credentials::WindowsCredentialStore;
pub use credentials::{CredentialError, CredentialStore, MemoryCredentialStore};

use crate::domain::LibraryAccess;
use crate::netapi::{MockNetApiTransport, NetApiError, NetApiTransport};

const SESSION_CREDENTIAL_KEY: &str = "netapi-session";

#[derive(Debug, Error)]
pub enum AccountError {
    #[error(transparent)]
    Remote(#[from] NetApiError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("account state is unavailable: {0}")]
    State(String),
    #[error("account login is required")]
    Unauthenticated,
}

#[derive(Debug)]
struct AccountState {
    session: AccountSessionView,
    summary: Option<AccountSummarySnapshot>,
    leaderboard: Option<LeaderboardSnapshot>,
}

pub struct AccountService {
    transport: Arc<dyn NetApiTransport>,
    credentials: Arc<dyn CredentialStore>,
    operation_gate: Mutex<()>,
    authorization_gate: RwLock<()>,
    state: Mutex<AccountState>,
}

pub struct LibraryAccessGuard<'a> {
    _guard: RwLockReadGuard<'a, ()>,
    access: LibraryAccess,
}

impl LibraryAccessGuard<'_> {
    pub fn access(&self) -> LibraryAccess {
        self.access
    }
}

impl fmt::Debug for AccountService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let session = self.state.lock().ok().map(|state| state.session.clone());
        formatter
            .debug_struct("AccountService")
            .field("source", &self.transport.source())
            .field("session", &session)
            .finish_non_exhaustive()
    }
}

impl AccountService {
    pub fn new(transport: Arc<dyn NetApiTransport>, credentials: Arc<dyn CredentialStore>) -> Self {
        let source = transport.source();
        let session = match credentials.load(SESSION_CREDENTIAL_KEY) {
            Ok(Some(token)) => match transport.restore_session(&token) {
                Ok(session)
                    if session.status == SessionStatus::SignedIn && session.user.is_some() =>
                {
                    session
                }
                Ok(_) | Err(_) => {
                    let _ = credentials.delete(SESSION_CREDENTIAL_KEY);
                    AccountSessionView::signed_out(source)
                }
            },
            Ok(None) | Err(_) => AccountSessionView::signed_out(source),
        };
        Self {
            transport,
            credentials,
            operation_gate: Mutex::new(()),
            authorization_gate: RwLock::new(()),
            state: Mutex::new(AccountState {
                session,
                summary: None,
                leaderboard: None,
            }),
        }
    }

    pub fn mock() -> Self {
        Self::new(
            Arc::new(MockNetApiTransport),
            Arc::new(MemoryCredentialStore::default()),
        )
    }

    pub fn mock_with_credentials(credentials: Arc<dyn CredentialStore>) -> Self {
        Self::new(Arc::new(MockNetApiTransport), credentials)
    }

    pub fn get_session(&self) -> Result<AccountSessionView, AccountError> {
        Ok(self.lock_state()?.session.clone())
    }

    pub fn library_access(&self) -> Result<LibraryAccessGuard<'_>, AccountError> {
        let guard = self
            .authorization_gate
            .read()
            .map_err(|_| AccountError::State("account authorization lock is poisoned".into()))?;
        let access = if self.lock_state()?.session.status == SessionStatus::SignedIn {
            LibraryAccess::SignedIn
        } else {
            LibraryAccess::SignedOut
        };
        Ok(LibraryAccessGuard {
            _guard: guard,
            access,
        })
    }

    pub fn login(&self, request: &LoginRequest) -> Result<AccountSessionView, AccountError> {
        let _operation = self.lock_operations()?;
        let authenticated = self.transport.login(request)?;
        if authenticated.view.status != SessionStatus::SignedIn || authenticated.view.user.is_none()
        {
            return Err(AccountError::Remote(NetApiError::InvalidResponse(
                "login response does not contain a signed-in user".into(),
            )));
        }

        let _authorization = self
            .authorization_gate
            .write()
            .map_err(|_| AccountError::State("account authorization lock is poisoned".into()))?;
        if let Err(error) = self
            .credentials
            .save(SESSION_CREDENTIAL_KEY, &authenticated.access_token)
        {
            let _ = self.transport.logout(&authenticated.access_token);
            return Err(error.into());
        }

        let mut state = self.lock_state()?;
        state.session = authenticated.view;
        state.summary = None;
        state.leaderboard = None;
        Ok(state.session.clone())
    }

    pub fn get_summary(&self, force_refresh: bool) -> Result<AccountSummarySnapshot, AccountError> {
        let _operation = self.lock_operations()?;
        {
            let state = self.lock_state()?;
            if state.session.status != SessionStatus::SignedIn {
                return Err(AccountError::Unauthenticated);
            }
            if !force_refresh {
                if let Some(snapshot) = &state.summary {
                    return Ok(snapshot.clone());
                }
            }
        }

        let token = self
            .credentials
            .load(SESSION_CREDENTIAL_KEY)?
            .ok_or(AccountError::Unauthenticated)?;
        match self.transport.get_summary(&token) {
            Ok(snapshot) => {
                self.lock_state()?.summary = Some(snapshot.clone());
                Ok(snapshot)
            }
            Err(NetApiError::Unauthorized) => {
                self.expire_session()?;
                Err(AccountError::Remote(NetApiError::Unauthorized))
            }
            Err(error) => Err(AccountError::Remote(error)),
        }
    }

    pub fn get_leaderboard(
        &self,
        query: &LeaderboardQuery,
    ) -> Result<LeaderboardSnapshot, AccountError> {
        let _operation = self.lock_operations()?;
        let limit = query.limit.unwrap_or(50);
        if !(1..=100).contains(&limit) {
            return Err(AccountError::Remote(NetApiError::InvalidResponse(
                "leaderboard limit must be between 1 and 100".into(),
            )));
        }
        {
            let state = self.lock_state()?;
            if state.session.status != SessionStatus::SignedIn {
                return Err(AccountError::Unauthenticated);
            }
            if query.cursor.is_none() && !query.force_refresh.unwrap_or(false) {
                if let Some(snapshot) = &state.leaderboard {
                    return Ok(snapshot.clone());
                }
            }
        }

        let token = self
            .credentials
            .load(SESSION_CREDENTIAL_KEY)?
            .ok_or(AccountError::Unauthenticated)?;
        match self
            .transport
            .get_leaderboard(&token, query.cursor.as_deref(), limit)
        {
            Ok(snapshot) => {
                if query.cursor.is_none() {
                    self.lock_state()?.leaderboard = Some(snapshot.clone());
                }
                Ok(snapshot)
            }
            Err(NetApiError::Unauthorized) => {
                self.expire_session()?;
                Err(AccountError::Remote(NetApiError::Unauthorized))
            }
            Err(error) => Err(AccountError::Remote(error)),
        }
    }

    /// Compatibility adapter for the legacy combined IPC contract.
    pub fn get_dashboard(&self, force_refresh: bool) -> Result<DashboardSnapshot, AccountError> {
        let summary = self.get_summary(force_refresh)?;
        let leaderboard = self.get_leaderboard(&LeaderboardQuery {
            force_refresh: Some(force_refresh),
            ..LeaderboardQuery::default()
        })?;
        Ok(DashboardSnapshot {
            generated_at: summary.generated_at,
            period: summary.period,
            today: summary.today,
            balance: summary.balance,
            leaderboard: leaderboard.rows,
            current_user_rank: leaderboard.current_user_rank,
            source: summary.source,
            stale: summary.stale || leaderboard.stale,
        })
    }

    pub fn logout(&self) -> Result<(), AccountError> {
        let _operation = self.lock_operations()?;
        let load_result = self.credentials.load(SESSION_CREDENTIAL_KEY);
        let remote_result = match &load_result {
            Ok(Some(token)) => self.transport.logout(token),
            Ok(None) | Err(_) => Ok(()),
        };
        let _authorization = self
            .authorization_gate
            .write()
            .map_err(|_| AccountError::State("account authorization lock is poisoned".into()))?;
        let credential_result = self.credentials.delete(SESSION_CREDENTIAL_KEY);
        {
            let mut state = self.lock_state()?;
            state.session = AccountSessionView::signed_out(self.transport.source());
            state.summary = None;
            state.leaderboard = None;
        }
        load_result?;
        credential_result?;
        remote_result.map_err(Into::into)
    }

    fn lock_operations(&self) -> Result<MutexGuard<'_, ()>, AccountError> {
        self.operation_gate
            .lock()
            .map_err(|_| AccountError::State("account operation lock is poisoned".into()))
    }

    fn expire_session(&self) -> Result<(), AccountError> {
        let _authorization = self
            .authorization_gate
            .write()
            .map_err(|_| AccountError::State("account authorization lock is poisoned".into()))?;
        let credential_result = self.credentials.delete(SESSION_CREDENTIAL_KEY);
        let mut state = self.lock_state()?;
        state.session = state.session.expired();
        state.summary = None;
        state.leaderboard = None;
        credential_result?;
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, AccountState>, AccountError> {
        self.state
            .lock()
            .map_err(|_| AccountError::State("account lock is poisoned".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netapi::{AuthenticatedSession, SecretString};
    use std::{sync::mpsc, thread, time::Duration};

    fn request(password: &str) -> LoginRequest {
        LoginRequest {
            identifier: crate::netapi::MOCK_ACCOUNT_IDENTIFIER.into(),
            password: password.into(),
        }
    }

    #[test]
    fn account_service_logs_in_caches_dashboard_and_logs_out() {
        let service = AccountService::mock();
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::SignedOut
        );

        let session = service
            .login(&request(crate::netapi::MOCK_ACCOUNT_PASSWORD))
            .unwrap();
        assert_eq!(session.status, SessionStatus::SignedIn);
        let first = service.get_dashboard(false).unwrap();
        let cached = service.get_dashboard(false).unwrap();
        assert_eq!(first, cached);

        service.logout().unwrap();
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::SignedOut
        );
        assert!(matches!(
            service.get_dashboard(false),
            Err(AccountError::Unauthenticated)
        ));
    }

    #[derive(Debug)]
    struct AlwaysUnauthorized;

    impl NetApiTransport for AlwaysUnauthorized {
        fn source(&self) -> DataSource {
            DataSource::Live
        }

        fn login(&self, _request: &LoginRequest) -> Result<AuthenticatedSession, NetApiError> {
            Ok(AuthenticatedSession {
                view: AccountSessionView {
                    status: SessionStatus::SignedIn,
                    user: Some(AccountUser {
                        id: "user-1".into(),
                        display_name: "Test User".into(),
                        email: None,
                    }),
                    expires_at: None,
                    source: DataSource::Live,
                },
                access_token: SecretString::new("expired"),
            })
        }

        fn restore_session(
            &self,
            _access_token: &SecretString,
        ) -> Result<AccountSessionView, NetApiError> {
            Err(NetApiError::Unauthorized)
        }

        fn get_summary(
            &self,
            _access_token: &SecretString,
        ) -> Result<AccountSummarySnapshot, NetApiError> {
            Err(NetApiError::Unauthorized)
        }

        fn get_leaderboard(
            &self,
            _access_token: &SecretString,
            _cursor: Option<&str>,
            _limit: u32,
        ) -> Result<LeaderboardSnapshot, NetApiError> {
            Err(NetApiError::Unauthorized)
        }

        fn logout(&self, _access_token: &SecretString) -> Result<(), NetApiError> {
            Ok(())
        }
    }

    #[test]
    fn unauthorized_dashboard_marks_session_expired_and_removes_token() {
        let credentials = Arc::new(MemoryCredentialStore::default());
        let service = AccountService::new(Arc::new(AlwaysUnauthorized), credentials.clone());
        service
            .login(&request(crate::netapi::MOCK_ACCOUNT_PASSWORD))
            .unwrap();

        assert!(matches!(
            service.get_dashboard(true),
            Err(AccountError::Remote(NetApiError::Unauthorized))
        ));
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::Expired
        );
        assert!(credentials.load(SESSION_CREDENTIAL_KEY).unwrap().is_none());
    }

    #[test]
    fn public_serialized_views_never_include_access_tokens() {
        let service = AccountService::mock();
        let session = service
            .login(&request(crate::netapi::MOCK_ACCOUNT_PASSWORD))
            .unwrap();
        let dashboard = service.get_dashboard(true).unwrap();
        let serialized = serde_json::to_string(&(session, dashboard)).unwrap();

        assert!(!serialized.contains("mock-session"));
        assert!(!serialized.contains("accessToken"));
        assert!(!format!("{service:?}").contains("mock-session"));
    }

    #[test]
    fn demo_session_restores_from_persistent_credential_store() {
        let credentials = Arc::new(MemoryCredentialStore::default());
        let first = AccountService::mock_with_credentials(credentials.clone());
        first
            .login(&request(crate::netapi::MOCK_ACCOUNT_PASSWORD))
            .unwrap();
        drop(first);

        let restored = AccountService::mock_with_credentials(credentials);
        let session = restored.get_session().unwrap();
        assert_eq!(session.status, SessionStatus::SignedIn);
        assert_eq!(
            session.user.and_then(|user| user.email),
            Some(crate::netapi::MOCK_ACCOUNT_IDENTIFIER.into())
        );
    }

    #[test]
    fn invalid_persisted_token_fails_closed_and_is_deleted() {
        let credentials = Arc::new(MemoryCredentialStore::default());
        credentials
            .save(
                SESSION_CREDENTIAL_KEY,
                &SecretString::new("not-a-demo-token"),
            )
            .unwrap();

        let service = AccountService::mock_with_credentials(credentials.clone());
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::SignedOut
        );
        assert!(credentials.load(SESSION_CREDENTIAL_KEY).unwrap().is_none());
    }

    #[test]
    fn logout_waits_for_an_in_flight_library_authorization() {
        let service = Arc::new(AccountService::mock());
        service
            .login(&request(crate::netapi::MOCK_ACCOUNT_PASSWORD))
            .unwrap();
        let access = service.library_access().unwrap();
        assert_eq!(access.access(), LibraryAccess::SignedIn);
        assert!(service.authorization_gate.try_write().is_err());

        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let logout_service = service.clone();
        let worker = thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = logout_service.logout();
            finished_tx.send(result).unwrap();
        });

        started_rx.recv().unwrap();
        assert!(finished_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::SignedIn
        );

        drop(access);
        finished_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        worker.join().unwrap();
        assert_eq!(
            service.get_session().unwrap().status,
            SessionStatus::SignedOut
        );
    }
}
