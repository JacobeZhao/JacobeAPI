use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataSource {
    Mock,
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    SignedOut,
    SignedIn,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionView {
    pub status: SessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AccountUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub source: DataSource,
}

impl AccountSessionView {
    pub fn signed_out(source: DataSource) -> Self {
        Self {
            status: SessionStatus::SignedOut,
            user: None,
            expires_at: None,
            source,
        }
    }

    pub fn expired(&self) -> Self {
        Self {
            status: SessionStatus::Expired,
            user: self.user.clone(),
            expires_at: self.expires_at.clone(),
            source: self.source,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
}

impl fmt::Debug for LoginRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoginRequest")
            .field("identifier", &self.identifier)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCount {
    // Decimal strings avoid losing u64 precision in JavaScript.
    pub input: String,
    pub output: String,
    pub cached_input: String,
    pub total: String,
    pub requests: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum BalanceView {
    Available {
        value: String,
        unit: String,
        display: String,
    },
    Unavailable {
        display: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        unit: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Unlimited {
        display: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        unit: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPeriod {
    pub timezone: String,
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardRow {
    pub rank: u32,
    pub user_id: String,
    pub display_name: String,
    pub tokens: String,
    pub is_current_user: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummarySnapshot {
    pub generated_at: String,
    pub period: DashboardPeriod,
    pub today: TokenCount,
    pub balance: BalanceView,
    pub source: DataSource,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardSnapshot {
    pub generated_at: String,
    pub period: DashboardPeriod,
    pub rows: Vec<LeaderboardRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_user_rank: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub source: DataSource,
    pub stale: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LeaderboardQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub force_refresh: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub generated_at: String,
    pub period: DashboardPeriod,
    pub today: TokenCount,
    pub balance: BalanceView,
    pub leaderboard: Vec<LeaderboardRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_user_rank: Option<u32>,
    pub source: DataSource,
    pub stale: bool,
}
