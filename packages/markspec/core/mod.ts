/**
 * @module core
 *
 * Core library for MarkSpec — parser, validator, ID graph,
 * traceability, and all output formats (JSON, ReqIF, CSV, PDF).
 *
 * This is the library boundary. Everything outside core/ imports
 * from core/mod.ts, never from internal paths.
 */

export const VERSION = "0.0.1";

// Model types
export {
  ConfigError,
  DEFAULT_PROJECT_CONFIG,
  REFHUB_URL,
} from "./model/mod.ts";
export type {
  Attribute,
  BuiltinType,
  ConfigFieldError,
  Diagnostic,
  DisplayId,
  Entry,
  EntrySource,
  EntryType,
  ProjectConfig,
  Severity,
  SourceLocation,
  Ulid,
} from "./model/mod.ts";

// Config
export {
  discoverProjectRoot,
  loadConfig,
  parseProjectConfig,
} from "./config/mod.ts";
export type { LoadConfigResult, ReadFile } from "./config/mod.ts";

// Parser
export { parse } from "./parser/mod.ts";
export type { ParseOptions } from "./parser/mod.ts";

// Formatter
export { format } from "./formatter/mod.ts";
export type { FormatResult } from "./formatter/mod.ts";

// Validator
export { validate } from "./validator/mod.ts";
export type { ValidateResult } from "./validator/mod.ts";

// Compiler
export { compile } from "./compiler/mod.ts";
export type { CompileResult } from "./compiler/mod.ts";

// Reporter
export { report } from "./reporter/mod.ts";
export type { ExportFormat, ReportOptions } from "./reporter/mod.ts";
