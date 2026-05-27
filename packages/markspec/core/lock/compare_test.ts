/**
 * @module core/lock/compare_test
 *
 * Tests for isBelowFloor — slice B of the install/upgrade devex epic.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { isBelowFloor } from "./compare.ts";

Deno.test("isBelowFloor: actual greater than floor → false", () => {
  assertEquals(isBelowFloor("0.6.1", "0.6"), false);
  assertEquals(isBelowFloor("0.7.0", "0.6"), false);
  assertEquals(isBelowFloor("1.0.0", "0.6"), false);
  assertEquals(isBelowFloor("10.0.0", "1.0"), false);
});

Deno.test("isBelowFloor: actual equal to floor → false", () => {
  assertEquals(isBelowFloor("0.6.0", "0.6"), false);
  assertEquals(isBelowFloor("1.0.0", "1.0"), false);
});

Deno.test("isBelowFloor: actual below floor → true", () => {
  assertEquals(isBelowFloor("0.5.99", "0.6"), true);
  assertEquals(isBelowFloor("0.5.0", "0.6"), true);
  assertEquals(isBelowFloor("0.6.1", "1.0"), true);
  assertEquals(isBelowFloor("0.6.1", "0.7"), true);
});

Deno.test("isBelowFloor: floor undefined → false (no floor)", () => {
  assertEquals(isBelowFloor("0.6.1", undefined), false);
  assertEquals(isBelowFloor("0.0.0", undefined), false);
});

Deno.test("isBelowFloor: throws on invalid floor", () => {
  assertThrows(() => isBelowFloor("0.6.1", "0.6.1"), Error); // 3 components
  assertThrows(() => isBelowFloor("0.6.1", "v0.6"), Error); // v prefix
  assertThrows(() => isBelowFloor("0.6.1", "0.06"), Error); // leading zero
  assertThrows(() => isBelowFloor("0.6.1", ""), Error);
  assertThrows(() => isBelowFloor("0.6.1", "0"), Error);
});

Deno.test("isBelowFloor: throws on invalid actualVersion", () => {
  assertThrows(() => isBelowFloor("v0.6.1", "0.6"), Error);
  assertThrows(() => isBelowFloor("0.06", "0.6"), Error);
  assertThrows(() => isBelowFloor("", "0.6"), Error);
});

Deno.test("isBelowFloor: accepts pre-release and build metadata in actual", () => {
  // Standard semver may include -pre.1 or +build.123 suffixes.
  // The comparison ignores them, only major.minor matter.
  assertEquals(isBelowFloor("0.6.1-beta.1", "0.6"), false);
  assertEquals(isBelowFloor("0.6.0+build.42", "0.6"), false);
  assertEquals(isBelowFloor("0.5.0-rc.1", "0.6"), true);
});
