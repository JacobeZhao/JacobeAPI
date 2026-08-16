use sha2::{Digest, Sha256};

use super::{
    AccountSessionView, AccountSummarySnapshot, AccountUser, AuthenticatedSession, BalanceView,
    DashboardPeriod, DataSource, LeaderboardRow, LeaderboardSnapshot, LoginRequest, NetApiError,
    NetApiTransport, SecretString, SessionStatus, TokenCount,
};

const GENERATED_AT: &str = "2026-08-16T00:00:00Z";
const EXPIRES_AT: &str = "2099-12-31T23:59:59Z";
const PERIOD_STARTS_AT: &str = "2026-08-15T16:00:00Z";
const PERIOD_ENDS_AT: &str = "2026-08-16T16:00:00Z";
const TOKEN_PREFIX: &str = "mock-session:";
pub const MOCK_ACCOUNT_IDENTIFIER: &str = "demo@netapi.cc";
pub const MOCK_ACCOUNT_PASSWORD: &str = "jacobe-demo";

#[derive(Debug, Default)]
pub struct MockNetApiTransport;

impl MockNetApiTransport {
    fn period() -> DashboardPeriod {
        DashboardPeriod {
            timezone: "Asia/Shanghai".into(),
            starts_at: PERIOD_STARTS_AT.into(),
            ends_at: PERIOD_ENDS_AT.into(),
        }
    }

    fn user_id(identifier: &str) -> String {
        let digest = Sha256::digest(identifier.trim().to_ascii_lowercase().as_bytes());
        format!("mock-{}", &hex::encode(digest)[..16])
    }

    fn user_id_from_token(token: &SecretString) -> Result<&str, NetApiError> {
        token
            .expose()
            .strip_prefix(TOKEN_PREFIX)
            .filter(|value| !value.is_empty())
            .ok_or(NetApiError::Unauthorized)
    }
}

impl NetApiTransport for MockNetApiTransport {
    fn source(&self) -> DataSource {
        DataSource::Mock
    }

    fn login(&self, request: &LoginRequest) -> Result<AuthenticatedSession, NetApiError> {
        let identifier = request.identifier.trim();
        if !identifier.eq_ignore_ascii_case(MOCK_ACCOUNT_IDENTIFIER) {
            // Non-demo accounts belong to the future HTTP transport. Never
            // present mock balances for a real account identifier.
            return Err(NetApiError::Unavailable);
        }
        if request.password != MOCK_ACCOUNT_PASSWORD {
            match request.password.as_str() {
                "rate-limited" => return Err(NetApiError::RateLimited),
                "timeout" => return Err(NetApiError::Timeout),
                "offline" => return Err(NetApiError::Unavailable),
                _ => return Err(NetApiError::InvalidCredentials),
            }
        }
        if identifier.is_empty() {
            return Err(NetApiError::InvalidCredentials);
        }

        let normalized_identifier = identifier.to_ascii_lowercase();
        let user_id = Self::user_id(&normalized_identifier);
        let display_name = normalized_identifier
            .split('@')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("Jacobe User")
            .to_string();
        Ok(AuthenticatedSession {
            view: AccountSessionView {
                status: SessionStatus::SignedIn,
                user: Some(AccountUser {
                    id: user_id.clone(),
                    display_name,
                    email: normalized_identifier
                        .contains('@')
                        .then_some(normalized_identifier),
                }),
                expires_at: Some(EXPIRES_AT.into()),
                source: DataSource::Mock,
            },
            access_token: SecretString::new(format!("{TOKEN_PREFIX}{user_id}")),
        })
    }

    fn restore_session(
        &self,
        access_token: &SecretString,
    ) -> Result<AccountSessionView, NetApiError> {
        let expected_user_id = Self::user_id(MOCK_ACCOUNT_IDENTIFIER);
        if Self::user_id_from_token(access_token)? != expected_user_id {
            return Err(NetApiError::Unauthorized);
        }
        Ok(AccountSessionView {
            status: SessionStatus::SignedIn,
            user: Some(AccountUser {
                id: expected_user_id,
                display_name: "demo".into(),
                email: Some(MOCK_ACCOUNT_IDENTIFIER.into()),
            }),
            expires_at: Some(EXPIRES_AT.into()),
            source: DataSource::Mock,
        })
    }

    fn get_summary(
        &self,
        access_token: &SecretString,
    ) -> Result<AccountSummarySnapshot, NetApiError> {
        Self::user_id_from_token(access_token)?;
        Ok(AccountSummarySnapshot {
            generated_at: GENERATED_AT.into(),
            period: Self::period(),
            today: TokenCount {
                input: "12400".into(),
                output: "4400".into(),
                cached_input: "0".into(),
                total: "16800".into(),
                requests: "32".into(),
            },
            balance: BalanceView::Available {
                value: "42.50".into(),
                unit: "CNY".into(),
                display: "\u{00a5}42.50".into(),
            },
            source: DataSource::Mock,
            stale: false,
        })
    }

    fn get_leaderboard(
        &self,
        access_token: &SecretString,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<LeaderboardSnapshot, NetApiError> {
        let user_id = Self::user_id_from_token(access_token)?.to_string();
        if cursor.is_some_and(|value| value != "mock-page-2") || !(1..=100).contains(&limit) {
            return Err(NetApiError::InvalidResponse(
                "invalid mock leaderboard pagination".into(),
            ));
        }
        let rows = vec![
            LeaderboardRow {
                rank: 1,
                user_id: "mock-leader-1".into(),
                display_name: "Prompt Pilot".into(),
                tokens: "985000".into(),
                is_current_user: false,
            },
            LeaderboardRow {
                rank: 2,
                user_id: user_id.clone(),
                display_name: "Current User".into(),
                tokens: "734000".into(),
                is_current_user: true,
            },
            LeaderboardRow {
                rank: 3,
                user_id: "mock-leader-3".into(),
                display_name: "Toolsmith".into(),
                tokens: "621500".into(),
                is_current_user: false,
            },
        ]
        .into_iter()
        .take(limit as usize)
        .collect();
        Ok(LeaderboardSnapshot {
            generated_at: GENERATED_AT.into(),
            period: Self::period(),
            rows,
            current_user_rank: Some(2),
            next_cursor: None,
            source: DataSource::Mock,
            stale: false,
        })
    }

    fn logout(&self, access_token: &SecretString) -> Result<(), NetApiError> {
        Self::user_id_from_token(access_token).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(identifier: &str, password: &str) -> LoginRequest {
        LoginRequest {
            identifier: identifier.into(),
            password: password.into(),
        }
    }

    #[test]
    fn mock_login_and_account_views_are_deterministic() {
        let transport = MockNetApiTransport;
        let first = transport
            .login(&request("DEMO@netapi.cc", MOCK_ACCOUNT_PASSWORD))
            .unwrap();
        let second = transport
            .login(&request(MOCK_ACCOUNT_IDENTIFIER, MOCK_ACCOUNT_PASSWORD))
            .unwrap();

        assert_eq!(first.view.user, second.view.user);
        assert_eq!(
            transport.get_summary(&first.access_token).unwrap(),
            transport.get_summary(&second.access_token).unwrap()
        );
        assert_eq!(
            transport
                .get_leaderboard(&first.access_token, None, 50)
                .unwrap(),
            transport
                .get_leaderboard(&second.access_token, None, 50)
                .unwrap()
        );
    }

    #[test]
    fn mock_exposes_stable_failure_scenarios() {
        let transport = MockNetApiTransport;
        assert!(matches!(
            transport.login(&request(MOCK_ACCOUNT_IDENTIFIER, "invalid")),
            Err(NetApiError::InvalidCredentials)
        ));
        assert!(matches!(
            transport.login(&request(MOCK_ACCOUNT_IDENTIFIER, "rate-limited")),
            Err(NetApiError::RateLimited)
        ));
        assert!(matches!(
            transport.login(&request("real-user@example.com", MOCK_ACCOUNT_PASSWORD)),
            Err(NetApiError::Unavailable)
        ));
        assert!(matches!(
            transport.get_summary(&SecretString::new("not-a-session")),
            Err(NetApiError::Unauthorized)
        ));
    }
}
