/**
 * @module cli/init
 *
 * Barrel for the `markspec init` subcommand internals. The CLI command
 * in `cli/commands/init.ts` consumes only `runInit` and the type
 * re-exports below.
 */

export { runInit } from "./orchestrator.ts";
export type { ExecRunner, McpRunner, RunInitOptions } from "./orchestrator.ts";
export type {
  Action,
  BinaryRef,
  ClientSet,
  ErrorCode,
  InitClientId,
  InitResult,
  ProfileChoice,
  Warning,
  WritePlan,
} from "./types.ts";
export { renderJsonSummary, renderTextSummary } from "./summary.ts";
export { createDenoFs, createMemFs } from "./fake_fs.ts";
export { parseProfileSpec } from "./profile_picker.ts";
