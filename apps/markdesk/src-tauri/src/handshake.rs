//! Parsing of the one-line handshake that `markspec desk --serve` prints on
//! stdout once its loopback listener is ready.

use serde::{Deserialize, Serialize};

/// Desk API version this shell speaks. A sidecar that reports another
/// version is stopped before it replaces the live sidecar.
pub const EXPECTED_API_VERSION: u32 = 3;

/// The sidecar handshake: where the desk API listens, the bearer token it
/// expects, the API version it speaks, and the product root it serves.
///
/// The same shape is returned to the web UI by `open_product`, so it
/// serializes with camelCase keys (`apiVersion`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Handshake {
    /// Base URL of the desk API, for example `http://127.0.0.1:53211`.
    pub url: String,
    /// Bearer token required on every desk API request.
    pub token: String,
    /// Desk API version the sidecar speaks.
    pub api_version: u32,
    /// Absolute, symlink-resolved product root the sidecar serves.
    pub root: String,
}

/// Parse one handshake line. Every field is required; an empty `url`,
/// `token`, or `root` is rejected.
pub fn parse(line: &str) -> Result<Handshake, String> {
    let handshake: Handshake = serde_json::from_str(line.trim())
        .map_err(|err| format!("invalid handshake line: {err}"))?;
    for (field, value) in [
        ("url", &handshake.url),
        ("token", &handshake.token),
        ("root", &handshake.root),
    ] {
        if value.is_empty() {
            return Err(format!("invalid handshake line: empty {field}"));
        }
    }
    Ok(handshake)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = r#"{"url":"http://127.0.0.1:53211","token":"abc123","apiVersion":3,"root":"/home/me/product"}"#;

    #[test]
    fn parse_accepts_the_desk_serve_handshake_line() {
        let parsed = parse(LINE).expect("valid handshake");
        assert_eq!(
            parsed,
            Handshake {
                url: "http://127.0.0.1:53211".into(),
                token: "abc123".into(),
                api_version: 3,
                root: "/home/me/product".into(),
            }
        );
    }

    #[test]
    fn parse_accepts_a_trailing_newline() {
        assert!(parse(&format!("{LINE}\n")).is_ok());
    }

    #[test]
    fn parse_rejects_a_missing_token() {
        let line = r#"{"url":"http://127.0.0.1:1","apiVersion":3,"root":"/p"}"#;
        assert!(parse(line).is_err());
    }

    #[test]
    fn parse_rejects_a_missing_root() {
        let line = r#"{"url":"http://127.0.0.1:1","token":"t","apiVersion":3}"#;
        assert!(parse(line).is_err());
    }

    #[test]
    fn parse_rejects_an_empty_token() {
        let line = r#"{"url":"http://127.0.0.1:1","token":"","apiVersion":3,"root":"/p"}"#;
        assert!(parse(line).is_err());
    }

    #[test]
    fn parse_rejects_text_that_is_not_json() {
        assert!(parse("Listening on 127.0.0.1").is_err());
    }

    #[test]
    fn handshake_serializes_with_camel_case_keys() {
        let value = serde_json::to_value(parse(LINE).unwrap()).unwrap();
        assert_eq!(value["apiVersion"], 3);
        assert_eq!(value["root"], "/home/me/product");
    }
}
