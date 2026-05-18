/**
 * @module mcp/resources/profile_test
 *
 * Unit tests for the markspec://profile Markdown renderer.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderProfile } from "./profile.ts";

Deno.test("renderProfile: 'no profile configured' when chain is null", () => {
  const md = renderProfile(null);
  assertStringIncludes(md, "# MarkSpec Profile");
  assertStringIncludes(md, "No profile configured");
});

Deno.test("renderProfile: includes active profile id and version", () => {
  const md = renderProfile({
    tiers: [
      {
        id: "@org/aspice-swe-mini",
        version: "1.0.0",
        description: "ASPICE software-engineering subset profile.",
      },
      {
        id: "@driftsys/markspec-default",
        version: "0.3.0",
        description: "Default RFC 2119 baseline profile.",
      },
    ],
    types: [
      {
        name: "stakeholder-requirement",
        extends: "Requirement",
        displayIdPattern: "STK_{DOMAIN}_{NNNN}",
        color: "blue",
        requiredAttributes: ["Id"],
        allowedAttributes: ["Satisfies", "Labels"],
        outgoingLinks: ["satisfies"],
        incomingLinks: ["verified-by"],
        description: "Stakeholder need or expectation.",
      },
    ],
    universalRequired: ["Id"],
    universalAllowed: ["Labels"],
    linkKinds: ["satisfies", "derived-from", "verified-by"],
    labels: ["ASIL-A", "ASIL-B"],
  });

  assertStringIncludes(md, "**Active**: @org/aspice-swe-mini@1.0.0");
  assertStringIncludes(md, "**Inherits**: @driftsys/markspec-default@0.3.0");
  assertStringIncludes(md, "ASPICE software-engineering subset profile.");
  assertStringIncludes(md, "### stakeholder-requirement");
  assertStringIncludes(md, "STK_{DOMAIN}_{NNNN}");
  assertStringIncludes(md, "ASIL-A, ASIL-B");
  assertStringIncludes(md, "| satisfies");
});

Deno.test("renderProfile: omits sections that are empty", () => {
  const md = renderProfile({
    tiers: [{ id: "@org/x", version: "1.0.0", description: "" }],
    types: [],
    universalRequired: [],
    universalAllowed: [],
    linkKinds: [],
    labels: [],
  });
  assertEquals(md.includes("## Entry types"), false);
  assertEquals(md.includes("## Labels"), false);
  assertEquals(md.includes("## Link kinds"), false);
  assertEquals(md.includes("## Universal attributes"), false);
});
