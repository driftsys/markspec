/**
 * @module core/sync
 *
 * External-system sync model: mapping schema, locked-attribute
 * inference, NDJSON log encode/decode, status aggregation. Per-tool
 * connectors (Jira, DOORS, etc.) are out of scope here — see ADR-006
 * §Out-of-scope.
 */

export { parseMapping, validateMappings } from "./mapping.ts";
export type {
  AttributeMapping,
  ConflictPolicy,
  Direction,
  Mapping,
  ParseMappingResult,
} from "./mapping.ts";

export { inferLockedAttributes } from "./locked_attributes.ts";

export { encodeLogLine, parseLogLine } from "./log.ts";
export type { SyncLogEntry } from "./log.ts";

export { aggregateStatusByState } from "./status.ts";
export type { BoundEntryStatus, RemoteState } from "./status.ts";
