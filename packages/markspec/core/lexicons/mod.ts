/**
 * @module core/lexicons
 *
 * Bundled text lexicons used by prose-analysis lint rules.
 *
 * Internal to the markspec binary. Not re-exported from `core/mod.ts`
 * because no consumer outside `core/` currently needs it — prose-analysis
 * rules under `core/lint/rules/` import directly from this barrel. If an
 * external consumer (e.g. an LSP code action for PA-3 rules) ever needs
 * the loader, re-export through `core/mod.ts` at that time.
 */

export { type LexiconName, loadLexicon, parseLexiconText } from "./loader.ts";
