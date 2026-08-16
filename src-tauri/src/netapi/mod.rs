mod dto;
mod mock;

use std::fmt;

use thiserror::Error;
use zeroize::Zeroizing;

pub use dto::{
    AccountSessionView, AccountSummarySnapshot, AccountUser, BalanceView, DashboardPeriod,
    DashboardSnapshot, DataSource, LeaderboardQuery, LeaderboardRow, LeaderboardSnapshot,
    LoginRequest, SessionStatus, TokenCount,
};
pub use mock::{MockNetApiTransport, MOCK_ACCOUNT_IDENTIFIER, MOCK_ACCOUNT_PASSWORD};

pub struct SecretString(Zeroizing<String>);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(Zeroizing::new(value.into()))
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretString([REDACTED])")
    }
}

pub struct AuthenticatedSession {
    pub view: AccountSessionView,
    pub access_token: SecretString,
}

impl fmt::Debug for AuthenticatedSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthenticatedSession")
            .field("view", &self.view)
            .field("access_token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum NetApiError {
    #[error("credentials are invalid")]
    InvalidCredentials,
    #[error("the account session is not authorized")]
    Unauthorized,
    #[error("the account is not allowed to perform this operation")]
    Forbidden,
    #[error("the remote service rate limit was reached")]
    RateLimited,
    #[error("the remote service timed out")]
    Timeout,
    #[error("the remote service is unavailable")]
    Unavailable,
    #[error("the remote service returned invalid data: {0}")]
    InvalidResponse(String),
}

pub trait NetApiTransport: Send + Sync {
    fn source(&self) -> DataSource;
    fn login(&self, request: &LoginRequest) -> Result<AuthenticatedSession, NetApiError>;
    fn restore_session(
        &self,
        access_token: &SecretString,
    ) -> Result<AccountSessionView, NetApiError>;
    fn get_summary(
        &self,
        access_token: &SecretString,
    ) -> Result<AccountSummarySnapshot, NetApiError>;
    fn get_leaderboard(
        &self,
        access_token: &SecretString,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<LeaderboardSnapshot, NetApiError>;
    fn logout(&self, access_token: &SecretString) -> Result<(), NetApiError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_types_redact_debug_and_do_not_implement_serializable_dtos() {
        let request = LoginRequest {
            identifier: "person@example.com".into(),
            password: "do-not-print".into(),
        };
        let secret = SecretString::new("do-not-print");

        assert!(!format!("{request:?}").contains("do-not-print"));
        assert!(!format!("{secret:?}").contains("do-not-print"));
    }

    #[test]
    fn public_summary_dto_uses_camel_case_and_decimal_strings() {
        let summary = MockNetApiTransport
            .get_summary(&SecretString::new("mock-session:mock-user"))
            .unwrap();
        let value = serde_json::to_value(summary).unwrap();

        assert_eq!(value["today"]["total"], "16800");
        assert!(value.get("generatedAt").is_some());
        assert!(value.get("accessToken").is_none());
    }

    #[test]
    fn response_dtos_ignore_unknown_upstream_fields() {
        let value = serde_json::json!({
            "generatedAt": "2026-08-16T00:00:00Z",
            "period": { "timezone": "Asia/Shanghai", "startsAt": "a", "endsAt": "b", "future": true },
            "today": { "input": "1", "output": "2", "cachedInput": "3", "total": "6", "requests": "1", "future": true },
            "balance": { "state": "available", "value": "1.00", "unit": "CNY", "display": "¥1.00", "future": true },
            "source": "live",
            "stale": false,
            "future": true
        });
        assert!(serde_json::from_value::<AccountSummarySnapshot>(value).is_ok());
    }
}
