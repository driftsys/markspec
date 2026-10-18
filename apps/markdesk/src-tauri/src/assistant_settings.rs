//! The author's assistant choice. The functions here are pure; the command
//! layer in `lib.rs` loads and saves the settings with the store plugin.

use serde::{Deserialize, Serialize};

use crate::assistants::{AssistantId, TestOutcome, TestRun};

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

/// How to move aside a stored value that could not be read, so that it is
/// kept instead of overwritten. The main key is always deleted.
#[derive(Debug, PartialEq)]
pub struct CorruptMove {
    /// The value to write under the corrupt key; `None` when that key
    /// already holds an earlier unreadable value, which is kept.
    pub write_corrupt_key: Option<serde_json::Value>,
}

/// Decide how to move aside `corrupt`, the unreadable value of the main
/// key, given `corrupt_key`, the value already under the corrupt key.
/// Returns `None` when there is nothing to move.
pub fn corrupt_move(
    corrupt: Option<serde_json::Value>,
    corrupt_key: Option<&serde_json::Value>,
) -> Option<CorruptMove> {
    let value = corrupt?;
    Some(CorruptMove {
        write_corrupt_key: if corrupt_key.is_none() {
            Some(value)
        } else {
            None
        },
    })
}

/// The settings to store when the web UI sends `from_ui`. The shell owns
/// `copilot_confirmed`, so the stored value is kept and the UI value ignored.
pub fn merge_from_ui(stored: &AssistantSettings, from_ui: AssistantSettings) -> AssistantSettings {
    AssistantSettings {
        copilot_confirmed: stored.copilot_confirmed,
        ..from_ui
    }
}

/// The new `copilot_confirmed` value after a Test of Copilot ended as `run`
/// says: `Ok` confirms, `Failed` clears, other outcomes change nothing. A
/// `Failed` result that only means the assistant printed no reply changes
/// nothing, because the process itself succeeded.
pub fn copilot_confirmed_after(current: bool, run: &TestRun) -> bool {
    if run.no_reply {
        return current;
    }
    match run.result.outcome {
        TestOutcome::Ok => true,
        TestOutcome::Failed => false,
        TestOutcome::Usage | TestOutcome::Timeout | TestOutcome::Cancelled => current,
    }
}

/// The settings to save after a Test of `id` ended as `run`, given the
/// `stored` settings; `None` when nothing changes. Only a Test of Copilot
/// changes the settings.
pub fn settings_after_test(
    stored: &AssistantSettings,
    id: AssistantId,
    run: &TestRun,
) -> Option<AssistantSettings> {
    if id != AssistantId::Copilot {
        return None;
    }
    let confirmed = copilot_confirmed_after(stored.copilot_confirmed, run);
    (confirmed != stored.copilot_confirmed).then(|| AssistantSettings {
        copilot_confirmed: confirmed,
        ..stored.clone()
    })
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

    fn run(outcome: TestOutcome, no_reply: bool) -> TestRun {
        TestRun {
            result: crate::assistants::TestResult {
                outcome,
                reply: None,
                error: None,
            },
            no_reply,
        }
    }

    #[test]
    fn only_ok_confirms_and_only_failed_clears_copilot() {
        assert!(copilot_confirmed_after(false, &run(TestOutcome::Ok, false)));
        assert!(!copilot_confirmed_after(
            true,
            &run(TestOutcome::Failed, false)
        ));
        for outcome in [
            TestOutcome::Usage,
            TestOutcome::Timeout,
            TestOutcome::Cancelled,
        ] {
            assert!(copilot_confirmed_after(true, &run(outcome, false)));
            assert!(!copilot_confirmed_after(false, &run(outcome, false)));
        }
    }

    #[test]
    fn no_reply_failure_keeps_copilot_confirmation() {
        assert!(copilot_confirmed_after(
            true,
            &run(TestOutcome::Failed, true)
        ));
        assert!(!copilot_confirmed_after(
            false,
            &run(TestOutcome::Failed, true)
        ));
    }

    fn stored(confirmed: bool) -> AssistantSettings {
        AssistantSettings {
            selected: Some(AssistantId::Copilot),
            card_dismissed: true,
            copilot_confirmed: confirmed,
        }
    }

    #[test]
    fn settings_after_successful_copilot_test_store_confirmation() {
        let next = settings_after_test(
            &stored(false),
            AssistantId::Copilot,
            &run(TestOutcome::Ok, false),
        );
        assert_eq!(next, Some(stored(true)));
    }

    #[test]
    fn settings_after_failed_copilot_test_clear_confirmation() {
        let next = settings_after_test(
            &stored(true),
            AssistantId::Copilot,
            &run(TestOutcome::Failed, false),
        );
        assert_eq!(next, Some(stored(false)));
    }

    #[test]
    fn settings_after_test_unchanged_cases_save_nothing() {
        let copilot = AssistantId::Copilot;
        assert_eq!(
            settings_after_test(&stored(true), copilot, &run(TestOutcome::Ok, false)),
            None
        );
        assert_eq!(
            settings_after_test(&stored(true), copilot, &run(TestOutcome::Failed, true)),
            None
        );
        assert_eq!(
            settings_after_test(
                &stored(false),
                AssistantId::ClaudeCode,
                &run(TestOutcome::Ok, false)
            ),
            None
        );
    }

    #[test]
    fn merge_from_ui_keeps_stored_copilot_confirmation() {
        let from_ui = AssistantSettings {
            selected: Some(AssistantId::Codex),
            card_dismissed: true,
            copilot_confirmed: false,
        };
        let merged = merge_from_ui(&stored(true), from_ui);
        assert_eq!(
            merged,
            AssistantSettings {
                selected: Some(AssistantId::Codex),
                card_dismissed: true,
                copilot_confirmed: true,
            }
        );
        let from_ui = AssistantSettings {
            copilot_confirmed: true,
            ..AssistantSettings::default()
        };
        assert!(!merge_from_ui(&stored(false), from_ui).copilot_confirmed);
    }

    #[test]
    fn corrupt_move_writes_the_corrupt_key_when_it_is_empty() {
        let value = json!("text");
        assert_eq!(
            corrupt_move(Some(value.clone()), None),
            Some(CorruptMove {
                write_corrupt_key: Some(value)
            })
        );
    }

    #[test]
    fn corrupt_move_keeps_an_earlier_corrupt_value() {
        let earlier = json!({"selected": "gemini"});
        assert_eq!(
            corrupt_move(Some(json!("text")), Some(&earlier)),
            Some(CorruptMove {
                write_corrupt_key: None
            })
        );
    }

    #[test]
    fn corrupt_move_is_none_without_a_corrupt_value() {
        assert_eq!(corrupt_move(None, Some(&json!(1))), None);
    }
}
