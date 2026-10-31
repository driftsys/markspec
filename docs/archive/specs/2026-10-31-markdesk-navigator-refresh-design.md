# MarkDesk navigator refresh (#842)

Epic #826. Spec for the navigator refresh after files change on disk.

## Problem

The navigator loads `GET /api/v1/tree` once per opened product. The document
pane re-reads the selection when the window receives focus (#841), so after an
edit outside MarkDesk the two panes disagree until the product is opened again.

## Decision

1. **ETag on `/api/v1/tree`.** The 200 response carries a strong ETag: the
   quoted SHA-256 hex digest of the API version and the serialized tree. A
   request whose `If-None-Match` names the current tag gets 304 with no body.
   The compiled graph is already an mtime-refreshed cache, so building the tree
   on each check is linear in entries plus links and sends no body when nothing
   changed. `apiVersion` stays 3 (additive change).
2. **One shared refresh trigger in the UI.** A `RefreshProvider` under the
   product holds a `revision` counter, bumped on window focus, and a `refresh()`
   function. The navigator and the document pane both read the revision. #837
   (MarkDesk writes files) calls `refresh()` after a write instead of building a
   second path.
3. **Navigator keeps its state across a refresh.** The pane keeps the loaded
   tree while it revalidates, so the `Navigator` component is not remounted and
   expanded nodes survive. A 304 returns the same cached object, so state is not
   replaced and nothing re-renders. The selection lives in the history provider
   and is untouched. A removed entry simply has no row; the document pane
   already reports "could not show" for a 404 on the next read. A failed
   revalidation after a successful load keeps the shown tree.

## Alternatives considered

- **Client-side deep compare, no API change.** Re-fetch the tree on focus and
  replace state only when the JSON differs. Simpler, but sends the full tree on
  every focus and gives #837 nothing to reuse on the server side.
- **File watcher / server-sent events.** Rejected in ADR-035: a push would
  refresh a document while the author is still saving it; the focus trigger is
  the agreed signal.

## Acceptance (from #842)

- A new entry on disk appears in the navigator when the window receives focus.
- A removed entry disappears; a selection of it produces no error.
- An unchanged tree keeps expanded nodes and the selection on focus.
- `schemas/desk-api.json`, the generated client, and `api_test.ts` cover the
  ETag and 304 on `/tree`.
- ADR-035 "As built" describes the refresh.

Satisfies: SAD_DESK_0013 to SAD_DESK_0015 (same pattern, extended to the tree).
