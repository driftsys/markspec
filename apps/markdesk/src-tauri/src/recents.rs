//! The list of recently opened products. The functions here are pure; the
//! command layer in `lib.rs` loads and saves the list with the store plugin.

use serde::{Deserialize, Serialize};

/// Maximum number of products kept in the recents list.
pub const MAX_RECENTS: usize = 10;

/// One recently opened product, as persisted in `recents.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    /// Absolute product root, as reported by the sidecar handshake.
    pub root: String,
    /// Display name chosen by the author, if any.
    #[serde(default)]
    pub name: Option<String>,
}

/// The result of reading the stored recents value.
#[derive(Debug, PartialEq)]
pub struct Parsed {
    /// The recents list; empty when the value is missing or unreadable.
    pub list: Vec<Recent>,
    /// The stored value that could not be read, kept so the caller can
    /// move it aside instead of overwriting it.
    pub corrupt: Option<serde_json::Value>,
}

/// Read the stored recents value. A missing value gives an empty list. A
/// value of the wrong shape gives an empty list and is returned in
/// [`Parsed::corrupt`] so the author's history is not lost on the next save.
pub fn parse_stored(value: Option<serde_json::Value>) -> Parsed {
    match value {
        None => Parsed {
            list: Vec::new(),
            corrupt: None,
        },
        Some(value) => match serde_json::from_value::<Vec<Recent>>(value.clone()) {
            Ok(list) => Parsed {
                list,
                corrupt: None,
            },
            Err(_) => Parsed {
                list: Vec::new(),
                corrupt: Some(value),
            },
        },
    }
}

/// Move `root` to the front of `list`, adding it when absent. An existing
/// entry keeps its name. The result holds at most [`MAX_RECENTS`] entries;
/// the oldest entries are dropped.
pub fn touch(list: Vec<Recent>, root: &str) -> Vec<Recent> {
    let existing = list.iter().find(|r| r.root == root).cloned();
    let front = existing.unwrap_or_else(|| Recent {
        root: root.to_string(),
        name: None,
    });
    std::iter::once(front)
        .chain(list.into_iter().filter(|r| r.root != root))
        .take(MAX_RECENTS)
        .collect()
}

/// Remove the entry for `root` from `list`, if present.
pub fn remove(list: Vec<Recent>, root: &str) -> Vec<Recent> {
    list.into_iter().filter(|r| r.root != root).collect()
}

/// Set the display name of the entry for `root`. A name that is empty after
/// trimming clears the name. Does nothing when `root` is not in `list`.
pub fn set_name(list: Vec<Recent>, root: &str, name: &str) -> Vec<Recent> {
    let name = name.trim();
    list.into_iter()
        .map(|mut r| {
            if r.root == root {
                r.name = (!name.is_empty()).then(|| name.to_string());
            }
            r
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recent(root: &str) -> Recent {
        Recent {
            root: root.into(),
            name: None,
        }
    }

    #[test]
    fn parse_stored_reads_a_valid_list() {
        let value = serde_json::json!([{ "root": "/a", "name": "A" }]);
        let parsed = parse_stored(Some(value));
        assert_eq!(parsed.list.len(), 1);
        assert_eq!(parsed.list[0].root, "/a");
        assert!(parsed.corrupt.is_none());
    }

    #[test]
    fn parse_stored_treats_a_missing_value_as_empty() {
        let parsed = parse_stored(None);
        assert!(parsed.list.is_empty());
        assert!(parsed.corrupt.is_none());
    }

    #[test]
    fn parse_stored_keeps_an_unreadable_value_aside() {
        let value = serde_json::json!({ "unexpected": true });
        let parsed = parse_stored(Some(value.clone()));
        assert!(parsed.list.is_empty());
        assert_eq!(parsed.corrupt, Some(value));
    }

    fn roots(list: &[Recent]) -> Vec<&str> {
        list.iter().map(|r| r.root.as_str()).collect()
    }

    #[test]
    fn touch_adds_a_new_root_at_the_front() {
        let list = touch(vec![recent("/a"), recent("/b")], "/c");
        assert_eq!(roots(&list), ["/c", "/a", "/b"]);
    }

    #[test]
    fn touch_moves_an_existing_root_to_the_front_without_duplicating() {
        let mut named = recent("/b");
        named.name = Some("Brakes".into());
        let list = touch(vec![recent("/a"), named, recent("/c")], "/b");
        assert_eq!(roots(&list), ["/b", "/a", "/c"]);
        assert_eq!(list[0].name.as_deref(), Some("Brakes"));
    }

    #[test]
    fn touch_caps_the_list_and_drops_the_oldest() {
        let list: Vec<Recent> = (0..MAX_RECENTS).map(|i| recent(&format!("/{i}"))).collect();
        let list = touch(list, "/new");
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0].root, "/new");
        assert_eq!(list[MAX_RECENTS - 1].root, format!("/{}", MAX_RECENTS - 2));
        assert!(!list
            .iter()
            .any(|r| r.root == format!("/{}", MAX_RECENTS - 1)));
    }

    #[test]
    fn remove_deletes_by_root() {
        let list = remove(vec![recent("/a"), recent("/b"), recent("/c")], "/b");
        assert_eq!(roots(&list), ["/a", "/c"]);
    }

    #[test]
    fn remove_of_an_unknown_root_keeps_the_list() {
        let list = remove(vec![recent("/a")], "/z");
        assert_eq!(roots(&list), ["/a"]);
    }

    #[test]
    fn set_name_names_the_matching_entry_only() {
        let list = set_name(vec![recent("/a"), recent("/b")], "/b", "  Brakes ");
        assert_eq!(list[0].name, None);
        assert_eq!(list[1].name.as_deref(), Some("Brakes"));
    }

    #[test]
    fn set_name_with_a_blank_name_clears_it() {
        let mut named = recent("/a");
        named.name = Some("Old".into());
        let list = set_name(vec![named], "/a", "   ");
        assert_eq!(list[0].name, None);
    }
}
