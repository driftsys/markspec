/**
 * @module core
 *
 * Core library for MarkSpec — parser, validator, ID graph,
 * traceability, and all output formats (JSON, ReqIF, CSV, PDF).
 *
 * This is the library boundary. Everything outside core/ imports
 * from core/mod.ts, never from internal paths.
 */

export const VERSION = "0.4.0";

// Model types
export {
  ConfigError,
  DEFAULT_PROJECT_CONFIG,
  PALETTE_HUES,
  REFHUB_URL,
} from "./model/mod.ts";
export type {
  Attribute,
  Caption,
  CaptionConventions,
  CaptionPosition,
  ConfigFieldError,
  Diagnostic,
  Directive,
  DisplayId,
  EffectiveProfile,
  EffectiveTypeDef,
  EntityRef,
  EntityRefConvention,
  Entry,
  EntryShape,
  EntrySource,
  InlineRef,
  Link,
  LinkKind,
  PaletteHue,
  ProfileChain,
  ProjectConfig,
  Severity,
  SourceLocation,
  Ulid,
} from "./model/mod.ts";

// AST (canonical body-AST — spec docs/specs/markspec-core-data-model.md §2)
// SourceRange is body-relative (no `file`); use SourceLocation for file-absolute positions.
export { astEquivalent } from "./ast/equivalence.ts";
export { normalizeBodyAst } from "./ast/normalize.ts";
export { render } from "./ast/render.ts";
export type {
  AdmonitionKind,
  BlockquoteNode,
  BodyBlock,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  DefinitionPair,
  EntityRefMarker,
  FeatureNode,
  FigureNode,
  InlineContent,
  InlineMarker,
  ListItemNode,
  ListNode,
  MathNode,
  ModalMarker,
  ModalMarkerClass,
  NoteNode,
  ParagraphNode,
  SourceRange,
  TableNode,
  UnknownNode,
} from "./ast/nodes.ts";

// Config
export {
  discoverProjectRoot,
  loadConfig,
  parseProjectConfig,
} from "./config/mod.ts";
export type { LoadConfigResult, ReadFile } from "./config/mod.ts";

export {
  MARKSPEC_YAML_FILENAME,
  parseMarkspecYaml,
  readMarkspecYaml,
} from "./config/markspec.ts";
export type {
  MarkspecYaml,
  ParseMarkspecYamlResult,
} from "./config/markspec.ts";

// Profile system (ADR-008)
export {
  computeCacheKey,
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
  loadChain,
  loadProfileForCommand,
  mergeChain,
  parseManifest,
  resolveEntryColor,
  resolveGitSpecifier,
  resolveLocalSpecifier,
} from "./profile/mod.ts";
export type {
  AppendFile,
  CacheLocation,
  GitCacheKeyInput,
  LoadChainOptions,
  LoadChainResult,
  LoadProfileForCommandResult,
  MergeResult,
  ParseManifestResult,
  ResolvedProfileSource,
  ResolveGitOptions,
  RunGit,
  RunGitResult,
} from "./profile/mod.ts";

// Parser
export {
  detectCaptions,
  detectDirectives,
  detectInlineRefs,
  isSupportedExtension,
  loadGrammar,
  parse,
  parseFile,
  parseSource,
} from "./parser/mod.ts";
export type {
  DetectCaptionsOptions,
  DetectDirectivesOptions,
  DetectInlineRefsOptions,
  ParseFileResult,
  ParseOptions,
  ParseSourceOptions,
  ParseSourceResult,
} from "./parser/mod.ts";

// Formatter
export { format } from "./formatter/mod.ts";
export type { FormatOptions, FormatResult } from "./formatter/mod.ts";

// Validator
export {
  classifyEntriesStage,
  classifyEntry,
  compileDisplayIdPattern,
  effectiveScope,
  effectiveTraceRules,
  matchesAnyTarget,
  normalizeListValues,
  runPipeline,
  validate,
  validateAttributesForEntry,
  validateListingDocuments,
  validateTraceabilityForEntry,
  validateValue,
} from "./validator/mod.ts";
export type {
  ClassifyResult,
  ClassifyStageResult,
  EffectiveAttrScope,
  ListingFileContext,
  ListingKind,
  PipelineResult,
  ValidateResult,
  ValueValidator,
} from "./validator/mod.ts";

// Compiler
export {
  compile,
  generateInverses,
  serializeCompileResult,
} from "./compiler/mod.ts";
export type {
  CompileOptions,
  CompileResult,
  GenerateInversesResult,
  SerializedCompileResult,
} from "./compiler/mod.ts";

// Reporter
export { report } from "./reporter/mod.ts";
export type {
  ReportFormat,
  ReportKind,
  ReportOptions,
} from "./reporter/mod.ts";
