/**
 * @module core
 *
 * Core library for MarkSpec — parser, validator, ID graph,
 * traceability, and all output formats (JSON, ReqIF, CSV, PDF).
 *
 * This is the library boundary. Everything outside core/ imports
 * from core/mod.ts, never from internal paths.
 */

export const VERSION = "0.7.2";
export const CORE_SCHEMA_VERSION = 1;

// Model types
export {
  ConfigError,
  CORE_DISCIPLINE_REGISTRY,
  CORE_KINDS,
  CORE_RELATIONS,
  DEFAULT_PROJECT_CONFIG,
  descendantsOf,
  KNOWN_LINK_KINDS,
  LOCK_EXTRA_INVERSE_KEYS,
  makeDisplayId,
  makeUlid,
  MIXED_DISCIPLINE,
  PALETTE_HUES,
  REFHUB_URL,
} from "./model/mod.ts";
export type {
  Attribute,
  BodyToken,
  BodyTokenKind,
  Caption,
  CaptionConventions,
  CaptionPosition,
  ConfigFieldError,
  Diagnostic,
  Directive,
  Discipline,
  DisciplineRegistry,
  DisplayId,
  EarsTrigger,
  EffectiveProfile,
  EffectiveTypeDef,
  EntityRefConvention,
  Entry,
  EntryShape,
  EntrySource,
  ExtractorRule,
  InlineRef,
  KindDecl,
  LabelConcern,
  LabelConcernKind,
  LabelValue,
  Link,
  LinkKind,
  LoadedProfile,
  ModalCase,
  PaletteHue,
  ProfileChain,
  ProfileConvention,
  ProjectConfig,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  RelationDef,
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
  FeatureNode,
  FigureNode,
  InlineContent,
  ListItemNode,
  ListNode,
  MathNode,
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
  addProfileSpecifier,
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

export { buildEffectiveDisciplineRegistry } from "./profile/mod.ts";
export { inferDisciplineMode, resolveDisciplineMode } from "./profile/mod.ts";
// DisciplineMode type already re-exported via Task 2.
export {
  formatDisplayId,
  highestDisplayIdNumber,
  padDisplayIdNumber,
  parseDisplayIdPattern,
} from "./profile/mod.ts";
export type { DisplayIdPatternShape } from "./profile/mod.ts";

export {
  entryMatchesTargets,
  filterEntriesByTraceTargets,
  targetsForRelation,
} from "./profile/mod.ts";

export { buildProfileIntrospection } from "./profile/mod.ts";
export type {
  AttributeDetail,
  ConventionDetail,
  LabelConcernDetail,
  ProfileElementDetail,
  ProfileElementKind,
  ProfileElementRef,
  ProfileIntrospection,
  ProfileOverview,
  ProvenancedDescription,
  RelationDetail,
  TypeDetail,
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
  DocCommentBlockMeta,
  LanguageDocCommentSpec,
  LineMap,
  ParseFileResult,
  ParseOptions,
  ParseSourceOptions,
  ParseSourceResult,
  SupportedLanguage,
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
  suppressDeclaredAttrR010,
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
  SerializedEntry,
  SerializedTypeRegistry,
} from "./compiler/mod.ts";
export { buildManifest } from "./compiler/manifest.ts";
export type {
  ManifestEdgesBlock,
  ManifestEntriesBlock,
  ManifestJson,
} from "./compiler/manifest.ts";
export {
  buildEdgesNdjson,
  buildEntriesNdjson,
  indexToJson,
} from "./compiler/ndjson_writer.ts";
export type {
  EntriesNdjsonResult,
  EntryOffset,
} from "./compiler/ndjson_writer.ts";

// Reporter
export { report } from "./reporter/mod.ts";
export type {
  ReportFormat,
  ReportKind,
  ReportOptions,
} from "./reporter/mod.ts";

// Lint (prose-analysis)
export {
  ANTI_PATTERN_NOTE,
  computeScoreRollup,
  isProseScope,
  runLint,
} from "./lint/mod.ts";
export type {
  EntryScore,
  LintDiagnostic,
  LintOptions,
  LintResult,
  RuleContribution,
  ScoreRollup,
} from "./lint/mod.ts";

export * as typl from "./typl/mod.ts";

// ── Lockfile (ADR-022) ───────────────────────────────────────────────────
export {
  canonicalEdgeJson,
  checkDrift,
  extractEdgeQuads,
  hashCanonicalEdges,
  isBelowFloor,
  LOCKFILE_SCHEMA_VERSION,
  parseLockfile,
  resolveBoundEntries,
  resolveProfileChain,
  resolveReferences,
  resolveRegistries,
  resolveUpstreams,
  serializeLockfile,
  sha256Bytes,
  sha256String,
} from "./lock/mod.ts";
export type {
  BoundEntry as LockBoundEntry,
  BoundEntryBinding as LockBinding,
  EdgeQuad,
  FetchUrl,
  GeneratedCache,
  LockedAttributes,
  Lockfile,
  LockfileMeta,
  LockfileToolchain,
  ParseLockfileResult,
  ReadFile as LockReadFile,
  ResolvedBoundEntry,
  ResolvedProfile,
  ResolvedReference,
  ResolvedRegistry,
  ResolvedUpstreams,
  ResolveUpstreamsOptions,
  Upstream,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./lock/mod.ts";

// ── External sync model (ADR-022) ────────────────────────────────────────
export {
  aggregateStatusByState,
  encodeLogLine,
  inferLockedAttributes,
  parseLogLine,
  parseMapping,
  validateMappings,
} from "./sync/mod.ts";
export type {
  AttributeMapping,
  BoundEntryStatus,
  ConflictPolicy,
  Direction as SyncDirection,
  Mapping,
  ParseMappingResult,
  RemoteState,
  SyncLogEntry,
} from "./sync/mod.ts";

// ── Self-upgrade ─────────────────────────────────────────────────────────
export {
  type Arch as SelfUpgradeArch,
  assertTrustedReleaseUrl,
  classifyInstallPath,
  type ClassifyResult as SelfUpgradeClassifyResult,
  compareVersions,
  type Comparison,
  DEFAULT_RELEASES_API,
  DEFAULT_RELEASES_DOWNLOAD_BASE,
  detectTarget,
  type InstallSource,
  type Os as SelfUpgradeOs,
  parseSha256Line,
  type Platform as SelfUpgradePlatform,
  platformFromBuild,
  type ReleaseAssets,
  releaseAssets,
  type ReleaseEndpoints,
  type ResolveEndpointsInput,
  resolveReleaseEndpoints,
  type Target as SelfUpgradeTarget,
} from "./self_upgrade/mod.ts";
