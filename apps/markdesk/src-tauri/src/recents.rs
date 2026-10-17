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
