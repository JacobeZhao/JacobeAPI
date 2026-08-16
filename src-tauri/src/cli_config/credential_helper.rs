use std::fmt;

const DEMO_GATEWAY_KEY: &str = "jacobe-demo-mock-key-not-for-production";

#[derive(Clone, PartialEq, Eq)]
pub struct DemoGatewayCredential(&'static str);

impl DemoGatewayCredential {
    pub fn expose_for_stdout(&self) -> &str {
        self.0
    }
}

impl fmt::Debug for DemoGatewayCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DemoGatewayCredential([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CredentialHelperMode {
    NotRequested,
    Demo(DemoGatewayCredential),
    Invalid,
}

pub fn parse_credential_helper_args<I, S>(args: I) -> CredentialHelperMode
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args = args
        .into_iter()
        .map(|value| value.as_ref().to_owned())
        .collect::<Vec<_>>();
    if args.first().map(String::as_str) != Some("credential-helper") {
        return CredentialHelperMode::NotRequested;
    }
    if matches!(
        args.as_slice(),
        [_, client, profile]
            if matches!(client.as_str(), "codex" | "claude") && profile == "netapi-demo"
    ) {
        CredentialHelperMode::Demo(DemoGatewayCredential(DEMO_GATEWAY_KEY))
    } else {
        CredentialHelperMode::Invalid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_exact_demo_helper_arguments() {
        assert!(matches!(
            parse_credential_helper_args(["credential-helper", "codex", "netapi-demo"]),
            CredentialHelperMode::Demo(_)
        ));
        assert!(matches!(
            parse_credential_helper_args(["credential-helper", "claude", "netapi-demo"]),
            CredentialHelperMode::Demo(_)
        ));
        assert_eq!(
            parse_credential_helper_args(["credential-helper", "codex", "live"]),
            CredentialHelperMode::Invalid
        );
        assert_eq!(
            parse_credential_helper_args(["--autostart"]),
            CredentialHelperMode::NotRequested
        );
    }

    #[test]
    fn credential_debug_is_redacted() {
        let CredentialHelperMode::Demo(credential) =
            parse_credential_helper_args(["credential-helper", "codex", "netapi-demo"])
        else {
            panic!("expected demo credential");
        };
        assert!(!format!("{credential:?}").contains(credential.expose_for_stdout()));
    }
}
