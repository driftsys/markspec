import { test } from "node:test";
import { strict as assert } from "node:assert";
import { type IndexedInfo, renderState, type VersionInfo } from "./statusBar";

const VERSION_NO_FLOOR: VersionInfo = {
  release: "0.6.1",
  coreSchemaVersion: 1,
  minVersion: null,
  isBelow: false,
};

const VERSION_FLOOR_MET: VersionInfo = {
  release: "0.6.1",
  coreSchemaVersion: 1,
  minVersion: "0.6",
  isBelow: false,
};

const VERSION_BELOW_FLOOR: VersionInfo = {
  release: "0.5.99",
  coreSchemaVersion: 1,
  minVersion: "0.6",
  isBelow: true,
};

const INDEXED: IndexedInfo = { files: 12, entries: 187 };

test("renderState: starting", () => {
  const r = renderState("starting", undefined, undefined);
  assert.equal(r.text, "$(sync~spin) MarkSpec");
  assert.equal(r.tooltip, "MarkSpec LSP starting…");
  assert.equal(r.background, undefined);
});

test("renderState: failed", () => {
  const r = renderState("failed", undefined, undefined);
  assert.equal(r.text, "$(error) MarkSpec");
  assert.equal(r.tooltip, "MarkSpec LSP not running. Click to view output.");
  assert.equal(r.background, "error");
});

test("renderState: ready + indexed only (no version yet)", () => {
  const r = renderState("ready", INDEXED, undefined);
  assert.equal(r.text, "$(check) MarkSpec");
  assert.ok(r.tooltip.includes("**MarkSpec LSP** ready"));
  assert.ok(r.tooltip.includes("Indexed 12 files, 187 entries."));
  assert.ok(!r.tooltip.includes("Version:"));
  assert.equal(r.background, undefined);
});

test("renderState: ready + version only, no floor", () => {
  const r = renderState("ready", undefined, VERSION_NO_FLOOR);
  assert.equal(r.text, "$(check) MarkSpec");
  assert.ok(r.tooltip.includes("Version: 0.6.1"));
  assert.ok(r.tooltip.includes("No workspace floor declared"));
  assert.ok(!r.tooltip.includes("Indexed"));
  assert.equal(r.background, undefined);
});

test("renderState: ready + version only, floor met", () => {
  const r = renderState("ready", undefined, VERSION_FLOOR_MET);
  assert.equal(r.text, "$(check) MarkSpec");
  assert.ok(r.tooltip.includes("Version: 0.6.1"));
  assert.ok(r.tooltip.includes("Workspace floor: 0.6 ✓"));
  assert.equal(r.background, undefined);
});

test("renderState: ready + version only, below floor", () => {
  const r = renderState("ready", undefined, VERSION_BELOW_FLOOR);
  assert.equal(r.text, "$(warning) MarkSpec");
  assert.ok(r.tooltip.includes("**MarkSpec LSP** below workspace floor"));
  assert.ok(
    r.tooltip.includes("Running 0.5.99; project requires 0.6+."),
  );
  assert.ok(r.tooltip.includes("Reload window"));
  assert.equal(r.background, "warning");
});

test("renderState: ready + both, floor met", () => {
  const r = renderState("ready", INDEXED, VERSION_FLOOR_MET);
  assert.equal(r.text, "$(check) MarkSpec");
  assert.ok(r.tooltip.includes("Indexed 12 files, 187 entries."));
  assert.ok(r.tooltip.includes("Workspace floor: 0.6 ✓"));
  assert.equal(r.background, undefined);
});

test("renderState: ready + both, below floor", () => {
  const r = renderState("ready", INDEXED, VERSION_BELOW_FLOOR);
  assert.equal(r.text, "$(warning) MarkSpec");
  assert.ok(r.tooltip.includes("Indexed 12 files, 187 entries."));
  assert.ok(
    r.tooltip.includes("Running 0.5.99; project requires 0.6+."),
  );
  assert.equal(r.background, "warning");
});
