/**
 * @module core/profile/display_id_test
 */

import { assertEquals } from "@std/assert";
import {
  formatDisplayId,
  highestDisplayIdNumber,
  padDisplayIdNumber,
  parseDisplayIdPattern,
} from "./display_id.ts";

Deno.test("parseDisplayIdPattern: simple 4-digit prefix", () => {
  const shape = parseDisplayIdPattern("STK_{n:4d}");
  assertEquals(shape, { prefix: "STK_", width: 4, suffix: "" });
});

Deno.test("parseDisplayIdPattern: leading-zero form is equivalent", () => {
  const shape = parseDisplayIdPattern("STK_{n:04d}");
  assertEquals(shape, { prefix: "STK_", width: 4, suffix: "" });
});

Deno.test("parseDisplayIdPattern: 6-digit width", () => {
  const shape = parseDisplayIdPattern("STK_AEB_{n:6d}");
  assertEquals(shape, { prefix: "STK_AEB_", width: 6, suffix: "" });
});

Deno.test("parseDisplayIdPattern: suffix after placeholder", () => {
  const shape = parseDisplayIdPattern("REQ-{n:03d}-draft");
  assertEquals(shape, { prefix: "REQ-", width: 3, suffix: "-draft" });
});

Deno.test("parseDisplayIdPattern: empty prefix", () => {
  const shape = parseDisplayIdPattern("{n:4d}_TAIL");
  assertEquals(shape, { prefix: "", width: 4, suffix: "_TAIL" });
});

Deno.test("parseDisplayIdPattern: malformed returns undefined", () => {
  assertEquals(parseDisplayIdPattern("STK_NOPATTERN"), undefined);
  assertEquals(parseDisplayIdPattern("STK_{NNNN}"), undefined);
  assertEquals(parseDisplayIdPattern("STK_{n:0d}"), undefined); // zero width
  assertEquals(parseDisplayIdPattern(""), undefined);
});

Deno.test("parseDisplayIdPattern: scope placeholder stays literal", () => {
  // Schema documents {scope} but it is callers' job to substitute.
  // The parser sees it as part of the prefix.
  const shape = parseDisplayIdPattern("SRS_{scope}_{n:04d}");
  assertEquals(shape, {
    prefix: "SRS_{scope}_",
    width: 4,
    suffix: "",
  });
});

Deno.test("padDisplayIdNumber: pads to minimum width", () => {
  assertEquals(padDisplayIdNumber(1, 4), "0001");
  assertEquals(padDisplayIdNumber(123, 4), "0123");
  assertEquals(padDisplayIdNumber(1234, 4), "1234");
  // Wider than the pattern: respects printf %0Nd "minimum width" semantics.
  assertEquals(padDisplayIdNumber(12345, 4), "12345");
});

Deno.test("formatDisplayId: composes prefix + padded number + suffix", () => {
  const shape = { prefix: "STK_", width: 4, suffix: "" };
  assertEquals(formatDisplayId(shape, 7), "STK_0007");
  const wide = { prefix: "STK_AEB_", width: 6, suffix: "" };
  assertEquals(formatDisplayId(wide, 7), "STK_AEB_000007");
  const withSuffix = { prefix: "REQ-", width: 3, suffix: "-draft" };
  assertEquals(formatDisplayId(withSuffix, 12), "REQ-012-draft");
});

Deno.test("highestDisplayIdNumber: finds max within prefix+suffix match", () => {
  const shape = { prefix: "STK_AEB_", width: 4, suffix: "" };
  const entries = [
    { displayId: "STK_AEB_0001" },
    { displayId: "STK_AEB_0042" },
    { displayId: "STK_AEB_0007" },
    { displayId: "SYS_NOMATCH_0099" }, // different prefix
    { displayId: "STK_AEB_0099_extra" }, // wrong suffix shape — but our suffix is empty, so it matches
  ];
  // "STK_AEB_0099_extra" → starts with STK_AEB_, suffix "" matches anything,
  // numberPart = "0099_extra" → parseInt → 99. So 99 is the max.
  // (The trailing junk doesn't fail parseInt; this matches CLI behavior.)
  assertEquals(highestDisplayIdNumber(shape, entries), 99);
});

Deno.test("highestDisplayIdNumber: requires suffix match when shape has one", () => {
  const shape = { prefix: "REQ-", width: 3, suffix: "-draft" };
  const entries = [
    { displayId: "REQ-001-draft" },
    { displayId: "REQ-042-draft" },
    { displayId: "REQ-099" }, // missing suffix
  ];
  assertEquals(highestDisplayIdNumber(shape, entries), 42);
});

Deno.test("highestDisplayIdNumber: returns 0 when no matching IDs", () => {
  const shape = { prefix: "STK_", width: 4, suffix: "" };
  const entries = [{ displayId: "SYS_0001" }];
  assertEquals(highestDisplayIdNumber(shape, entries), 0);
});
