/**
 * @module render/captions_test
 *
 * Unit tests for caption numbering.
 */

import { assertEquals } from "@std/assert";
import {
  buildCaptionRegistry,
  type CaptionRegistry,
  numberCaptions,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to get a numbered caption by slug from a registry. */
function get(registry: CaptionRegistry, slug: string) {
  const nc = registry.captions.get(slug);
  if (!nc) throw new Error(`slug "${slug}" not found in registry`);
  return nc;
}

// ---------------------------------------------------------------------------
// buildCaptionRegistry
// ---------------------------------------------------------------------------

Deno.test("buildCaptionRegistry: single chapter with two figures", () => {
  const md = `# Introduction

![](img1.svg)

_Figure: First diagram_

![](img2.svg)

_Figure: Second diagram_
`;
  const registry = buildCaptionRegistry(md);
  const first = get(registry, "fig.first-diagram");
  const second = get(registry, "fig.second-diagram");

  assertEquals(first.label, "Figure 1.1");
  assertEquals(first.chapter, 1);
  assertEquals(first.sequence, 1);

  assertEquals(second.label, "Figure 1.2");
  assertEquals(second.chapter, 1);
  assertEquals(second.sequence, 2);
});

Deno.test("buildCaptionRegistry: two chapters each with a figure", () => {
  const md = `# Chapter One

![](a.svg)

_Figure: Alpha_

# Chapter Two

![](b.svg)

_Figure: Beta_
`;
  const registry = buildCaptionRegistry(md);
  const alpha = get(registry, "fig.alpha");
  const beta = get(registry, "fig.beta");

  assertEquals(alpha.label, "Figure 1.1");
  assertEquals(alpha.chapter, 1);
  assertEquals(alpha.sequence, 1);

  assertEquals(beta.label, "Figure 2.1");
  assertEquals(beta.chapter, 2);
  assertEquals(beta.sequence, 1);
});

Deno.test("buildCaptionRegistry: mixed figures and tables have independent counters", () => {
  const md = `# Design

![](arch.svg)

_Figure: Architecture_

_Table: Parameters_

| Key   | Value |
| ----- | ----- |
| Speed | 100   |

![](flow.svg)

_Figure: Data flow_
`;
  const registry = buildCaptionRegistry(md);
  const arch = get(registry, "fig.architecture");
  const params = get(registry, "tbl.parameters");
  const flow = get(registry, "fig.data-flow");

  assertEquals(arch.label, "Figure 1.1");
  assertEquals(params.label, "Table 1.1");
  assertEquals(flow.label, "Figure 1.2");
});

Deno.test("buildCaptionRegistry: document without H1 headings treats all as chapter 1", () => {
  const md = `Some intro text.

![](img.svg)

_Figure: Standalone_

_Table: Config_

| A | B |
| - | - |
| 1 | 2 |
`;
  const registry = buildCaptionRegistry(md);
  const fig = get(registry, "fig.standalone");
  const tbl = get(registry, "tbl.config");

  assertEquals(fig.label, "Figure 1.1");
  assertEquals(fig.chapter, 1);

  assertEquals(tbl.label, "Table 1.1");
  assertEquals(tbl.chapter, 1);
});

Deno.test("buildCaptionRegistry: empty document returns empty registry", () => {
  const registry = buildCaptionRegistry("");
  assertEquals(registry.captions.size, 0);
});

Deno.test("buildCaptionRegistry: registry lookup by slug works", () => {
  const md = `# Specs

_Table: Voltage limits_

| Rail  | Min | Max |
| ----- | --- | --- |
| 3.3 V | 3.1 | 3.5 |
`;
  const registry = buildCaptionRegistry(md);
  const nc = registry.captions.get("tbl.voltage-limits");

  assertEquals(nc !== undefined, true);
  assertEquals(nc!.label, "Table 1.1");
  assertEquals(nc!.caption.kind, "table");
  assertEquals(nc!.caption.text, "Voltage limits");
});

// ---------------------------------------------------------------------------
// numberCaptions
// ---------------------------------------------------------------------------

Deno.test("numberCaptions: replaces caption text correctly", () => {
  const md = `# Overview

![](sensor.svg)

_Figure: Sensor layout_

# Data

_Table: Thresholds_

| Sensor | Value |
| ------ | ----- |
| Temp   | 85    |

![](flow.svg)

_Figure: Processing flow_
`;
  const registry = buildCaptionRegistry(md);
  const result = numberCaptions(md, registry);

  assertEquals(result.includes("_Figure 1.1: Sensor layout_"), true);
  assertEquals(result.includes("_Table 2.1: Thresholds_"), true);
  assertEquals(result.includes("_Figure 2.1: Processing flow_"), true);

  // Originals should no longer be present.
  assertEquals(result.includes("_Figure: Sensor layout_"), false);
  assertEquals(result.includes("_Table: Thresholds_"), false);
  assertEquals(result.includes("_Figure: Processing flow_"), false);
});

Deno.test("numberCaptions: no-op on document without captions", () => {
  const md = `# Just text

Nothing to number here.
`;
  const registry = buildCaptionRegistry(md);
  const result = numberCaptions(md, registry);

  assertEquals(result, md);
});
