//! The author's assistant choice. The functions here are pure; the command
//! layer in `lib.rs` loads and saves the settings with the store plugin.

use serde::{Deserialize, Serialize};

use crate::assistants::{AssistantId, TestOutcome};

/// The assistant settings, as persisted under the `assistant` key.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssistantSettings {
    /// The assistant the author chose, if any.
    pub selected: Option<AssistantId>,
    /// The author closed the setup card on the start screen.
    pub card_dismissed: bool,
    /// A Test of Copilot succeeded, so its sign-in is treated as confirmed.
    pub copilot_confirmed: bool,
}

/// The result of reading the stored settings value.
#[derive(Debug, PartialEq)]
pub struct ParsedSettings {
    /// The settings; the defaults when the value is missing or unreadable.
    pub settings: AssistantSettings,
    /// The stored value that could not be read, kept so the caller can
    /// move it aside instead of overwriting it.
    pub corrupt: Option<serde_json::Value>,
}

/// Read the stored settings value. A missing value gives the defaults. A
/// value of the wrong shape gives the defaults and is returned in
/// [`ParsedSettings::corrupt`].
pub fn parse_stored(value: Option<serde_json::Value>) -> ParsedSettings {
    match value {
        None => ParsedSettings {
            settings: AssistantSettings::default(),
            corrupt: None,
        },
        Some(value) => match serde_json::from_value::<AssistantSettings>(value.clone()) {
            Ok(settings) => ParsedSettings {
                settings,
                corrupt: None,
            },
            Err(_) => ParsedSettings {
                settings: AssistantSettings::default(),
                corrupt: Some(value),
            },
        },
    }
}

/// The new `copilot_confirmed` value after a Test of Copilot ended with
/// `outcome`: `Ok` confirms, `Failed` clears, other outcomes change nothing.
pub fn copilot_confirmed_after(current: bool, outcome: TestOutcome) -> bool {
    match outcome {
        TestOutcome::Ok => true,
        TestOutcome::Failed => false,
        TestOutcome::Usage | TestOutcome::Timeout | TestOutcome::Cancelled => current,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_value_gives_defaults() {
        let parsed = parse_stored(None);
        assert_eq!(parsed.settings, AssistantSettings::default());
        assert!(parsed.corrupt.is_none());
    }

    #[test]
    fn round_trips_all_fields() {
        let value = json!({"selected":"codex","cardDismissed":true,"copilotConfirmed":true});
        let parsed = parse_stored(Some(value.clone()));
        assert_eq!(
            parsed.settings,
            AssistantSettings {
                selected: Some(AssistantId::Codex),
                card_dismissed: true,
                copilot_confirmed: true,
            }
        );
        assert!(parsed.corrupt.is_none());
        assert_eq!(serde_json::to_value(&parsed.settings).unwrap(), value);
    }

    #[test]
    fn null_selected_is_none() {
        let parsed = parse_stored(Some(json!({"selected": null})));
        assert_eq!(parsed.settings.selected, None);
        assert!(parsed.corrupt.is_none());
    }

    #[test]
    fn unknown_assistant_id_is_corrupt() {
        let value = json!({"selected":"gemini"});
        let parsed = parse_stored(Some(value.clone()));
        assert_eq!(parsed.settings, AssistantSettings::default());
        assert_eq!(parsed.corrupt, Some(value));
    }

    #[test]
    fn wrong_type_is_corrupt() {
        let value = json!("text");
        let parsed = parse_stored(Some(value.clone()));
        assert_eq!(parsed.settings, AssistantSettings::default());
        assert_eq!(parsed.corrupt, Some(value));
    }

    #[test]
    fn missing_fields_default() {
        let parsed = parse_stored(Some(json!({"selected":"copilot"})));
        assert_eq!(parsed.settings.selected, Some(AssistantId::Copilot));
        assert!(!parsed.settings.card_dismissed);
        assert!(!parsed.settings.copilot_confirmed);
        assert!(parsed.corrupt.is_none());
    }

    #[test]
    fn only_ok_confirms_and_only_failed_clears_copilot() {
        assert!(copilot_confirmed_after(false, TestOutcome::Ok));
        assert!(!copilot_confirmed_after(true, TestOutcome::Failed));
        for outcome in [
            TestOutcome::Usage,
            TestOutcome::Timeout,
            TestOutcome::Cancelled,
        ] {
            assert!(copilot_confirmed_after(true, outcome));
            assert!(!copilot_confirmed_after(false, outcome));
        }
    }
}
