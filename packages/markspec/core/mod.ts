/**
 * @module core
 *
 * Core library for MarkSpec — parser, validator, ID graph,
 * traceability, and all output formats (JSON, ReqIF, CSV, PDF).
 *
 * This is the library boundary. Everything outside core/ imports
 * from core/mod.ts, never from internal paths.
 */

export const VERSION = "0.10.3";

// Model types
export {
  ConfigError,
  CORE_DISCIPLINE_REGISTRY,
  CORE_KINDS,
  CORE_RELATIONS,
  CORE_SCHEMA_VERSION,
  DEFAULT_PROJECT_CONFIG,
  descendantsOf,
  formatEntryOrigin,
  KNOWN_LINK_KINDS,
  LOCK_EXTRA_INVERSE_KEYS,
  makeDisplayId,
  makeUlid,
  MIXED_DISCIPLINE,
  PALETTE_HUES,
  sameOriginSource,
} from "./model/mod.ts";
export type {
  Attribute,
  BodyToken,
  BodyTokenKind,
  Caption,
  CaptionConventions,
  CaptionPosition,
  ConfigFieldError,
  DeliveredDocument,
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
  EntryOrigin,
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
  ProjectRef,
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
  DEFAULT_TOOL_CONFIG,
  discoverMarkspecRoot,
  loadToolConfig,
  MARKSPEC_YAML_FILENAME,
  parseMarkspecYaml,
  readMarkspecYaml,
} from "./config/markspec.ts";
export type {
  MarkspecYaml,
  ParseMarkspecYamlResult,
  ToolConfig,
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
  validateDisplayIdPattern,
} from "./profile/mod.ts";
export type {
  DisplayIdPatternShape,
  DisplayIdPatternValidation,
} from "./profile/mod.ts";

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

// Delivered corpus loader
export {
  buildCorpusIndex,
  corpusOriginLabel,
  deliveredPathIsContained,
  loadDeliveredCorpus,
} from "./profile/delivered.ts";
export type {
  LoadDeliveredCorpusResult,
  RealPath,
} from "./profile/delivered.ts";

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
export {
  loadMarkdownFormatter,
  MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
  MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
} from "./formatter/dprint.ts";
export type { ProseFormatOptions, ProseFormatter } from "./formatter/dprint.ts";

// Validator
export {
  attributeCorpusDiagnostics,
  classifyEntriesStage,
  classifyEntry,
  compileDisplayIdPattern,
  detectCorpusCollisions,
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
  CorpusCollisionResult,
  EffectiveAttrScope,
  ListingFileContext,
  ListingKind,
  PipelineOptions,
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
  deriveUpstreamId,
  detectOfflineEdgeDrift,
  extractEdgeLedger,
  extractEdgeQuads,
  hashCanonicalEdges,
  isBelowFloor,
  LOCKFILE_SCHEMA_VERSION,
  parseLockfile,
  resolveBoundEntries,
  resolveProfileChain,
  resolveProjectReferences,
  resolveReferences,
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
  LockEdge,
  Lockfile,
  LockfileMeta,
  LockfileToolchain,
  OfflineEdgeDrift,
  ParseLockfileResult,
  ReadFile as LockReadFile,
  ResolvedBoundEntry,
  ResolvedProfile,
  ResolvedReference,
  ResolvedUpstreams,
  ResolveProjectReferencesOptions,
  ResolveProjectReferencesResult,
  ResolveUpstreamsOptions,
  Upstream,
  UpstreamDependency,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRefsIO,
  UpstreamRegistry,
} from "./lock/mod.ts";

// ── Trace-reference canonicalisation + heal (issue #593, Slice 4) ────────
export {
  buildRefIndex,
  canonicalizeRefs,
  TRACE_ATTRIBUTE_KEYS,
} from "./refs/mod.ts";
export type { RefIndex } from "./refs/mod.ts";

// ── Composite-`check` gate stages (ADR-027, #659) ─────────────────────────
export { fmtDriftGate, lockfileDriftGate, proseLintGate } from "./gates/mod.ts";

// ── Fenced-code-block detection (#668/#679/#680) ──────────────────────────
export { FENCE_RE, isLineFenced, walkProseLines } from "./util/fence.ts";
export type { ProseLineCallback } from "./util/fence.ts";
export { isUnsafeRelPath } from "./util/paths.ts";

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

// ── Gitignore-aware project file discovery ───────────────────────────────
export {
  discoverFiles,
  isIgnored,
  MARKDOWN_EXTENSIONS,
  parseGitignore,
  RELEVANT_EXTENSIONS,
  SOURCE_EXTENSIONS,
} from "./discovery/mod.ts";
export type {
  DiscoverOptions,
  DiscoveryDirEntry,
  DiscoveryIO,
  GitignoreRule,
} from "./discovery/mod.ts";

// ── Project-entry collection (discover + parse → Entry[]) ────────────────
export { collectProjectEntries } from "./collect/mod.ts";
export type { CollectOptions } from "./collect/mod.ts";

// ── Compiled-snapshot deserialization (federated upstream, slice 1) ──────
export {
  checkSnapshotSchema,
  deserializeEntry,
  extractSerializedEntries,
} from "./compiler/deserialize.ts";
export type { ExtractedEntries } from "./compiler/deserialize.ts";

// ── Upstream corpus loader (federated upstream, slice 1) ─────────────────
export { loadUpstreamCorpus } from "./upstream/mod.ts";
export type {
  LoadUpstreamCorpusResult,
  UpstreamSnapshotRef,
} from "./upstream/mod.ts";
