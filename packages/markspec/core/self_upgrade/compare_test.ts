import { assertEquals, assertThrows } from "@std/assert";
import { compareVersions } from "./compare.ts";

Deno.test("compareVersions: equal → up-to-date", () => {
  assertEquals(compareVersions("0.6.1", "0.6.1"), "up-to-date");
});

Deno.test("compareVersions: strips leading 'v' on both args", () => {
  assertEquals(compareVersions("v0.6.1", "v0.6.1"), "up-to-date");
  assertEquals(compareVersions("0.6.1", "v0.6.1"), "up-to-date");
  assertEquals(compareVersions("v0.6.1", "0.6.1"), "up-to-date");
});

Deno.test("compareVersions: target patch greater → newer-available", () => {
  assertEquals(compareVersions("0.6.1", "0.6.2"), "newer-available");
});

Deno.test("compareVersions: target minor greater → newer-available", () => {
  assertEquals(compareVersions("0.6.1", "0.7.0"), "newer-available");
});

Deno.test("compareVersions: target major greater → newer-available", () => {
  assertEquals(compareVersions("0.6.1", "1.0.0"), "newer-available");
});

Deno.test("compareVersions: target patch lower → downgrade", () => {
  assertEquals(compareVersions("0.6.2", "0.6.1"), "downgrade");
});

Deno.test("compareVersions: target minor lower → downgrade", () => {
  assertEquals(compareVersions("0.7.0", "0.6.99"), "downgrade");
});

Deno.test("compareVersions: malformed current throws", () => {
  assertThrows(
    () => compareVersions("not-a-version", "0.6.1"),
    Error,
    "invalid version",
  );
});

Deno.test("compareVersions: malformed target throws", () => {
  assertThrows(
    () => compareVersions("0.6.1", "not-a-version"),
    Error,
    "invalid version",
  );
});

Deno.test("compareVersions: handles double-digit components", () => {
  assertEquals(compareVersions("0.6.10", "0.6.9"), "downgrade");
  assertEquals(compareVersions("0.6.9", "0.6.10"), "newer-available");
});
