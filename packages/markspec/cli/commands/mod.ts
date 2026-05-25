/**
 * @module cli/commands
 *
 * CLI subcommand handlers — one file per subcommand group.
 * Re-exports all Command instances for use in main.ts.
 */

export { bookCmd } from "./book.ts";
export { compileCmd, exportCmd } from "./compile.ts";
export { contextCmd } from "./context_cmd.ts";
export { createCmd } from "./create.ts";
export { deckCmd } from "./deck.ts";
export { dependentsCmd } from "./dependents.ts";
export { docCmd } from "./doc.ts";
export { doctorCmd } from "./doctor.ts";
export { formatCmd } from "./format.ts";
export { hookCmd } from "./hook.ts";
export { insertCmd } from "./insert.ts";
export { lintCmd } from "./lint.ts";
export { lockCmd } from "./lock.ts";
export { lspCmd } from "./lsp_cmd.ts";
export { mcpCmd } from "./mcp_cmd.ts";
export { nextIdCmd } from "./next_id.ts";
export { profileCmd } from "./profile.ts";
export { reportCmd } from "./report.ts";
export { showCmd } from "./show.ts";
export { validateCmd } from "./validate.ts";
