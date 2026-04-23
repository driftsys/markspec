/**
 * @module lsp/context_test
 *
 * Unit tests for MarkSpec context guard — file-level and position-level.
 */

import { assertEquals } from "@std/assert";
import {
  isDocCommentContext,
  isMarkspecFile,
  isSourceFile,
} from "./context.ts";

// --- File-level guard ---

Deno.test("isMarkspecFile: accepts .md files", () => {
  assertEquals(isMarkspecFile("docs/reqs.md"), true);
});

Deno.test("isMarkspecFile: accepts .rs files", () => {
  assertEquals(isMarkspecFile("src/lib.rs"), true);
});

Deno.test("isMarkspecFile: accepts .kt files", () => {
  assertEquals(isMarkspecFile("src/Main.kt"), true);
});

Deno.test("isMarkspecFile: accepts .java files", () => {
  assertEquals(isMarkspecFile("src/Main.java"), true);
});

Deno.test("isMarkspecFile: accepts .c files", () => {
  assertEquals(isMarkspecFile("src/main.c"), true);
});

Deno.test("isMarkspecFile: accepts .cpp files", () => {
  assertEquals(isMarkspecFile("src/main.cpp"), true);
});

Deno.test("isMarkspecFile: rejects .txt files", () => {
  assertEquals(isMarkspecFile("readme.txt"), false);
});

Deno.test("isMarkspecFile: rejects .py files", () => {
  assertEquals(isMarkspecFile("script.py"), false);
});

Deno.test("isSourceFile: true for source extensions", () => {
  assertEquals(isSourceFile("lib.rs"), true);
  assertEquals(isSourceFile("Main.kt"), true);
  assertEquals(isSourceFile("App.java"), true);
  assertEquals(isSourceFile("main.c"), true);
  assertEquals(isSourceFile("main.cpp"), true);
});

Deno.test("isSourceFile: false for markdown", () => {
  assertEquals(isSourceFile("reqs.md"), false);
});

// --- Position-level guard ---

Deno.test("isDocCommentContext: detects entry marker nearby", () => {
  const lines = [
    "/// [SRS_AEB_0030] Time-to-collision calculation",
    "///",
    "/// The decision module shall compute TTC.",
    "///",
    "/// Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ \\",
    "/// Satisfies: SYS_AEB_0012",
  ];
  assertEquals(isDocCommentContext(lines, 3), true);
});

Deno.test("isDocCommentContext: detects trace attribute keyword nearby", () => {
  const lines = [
    "fn some_function() {",
    "    // some code",
    "    /// Satisfies: STK_001",
    "    // more code",
  ];
  assertEquals(isDocCommentContext(lines, 2), true);
});

Deno.test("isDocCommentContext: returns false for plain code", () => {
  const lines = [
    "fn main() {",
    '    println!("hello");',
    "    let x = 42;",
    "}",
  ];
  assertEquals(isDocCommentContext(lines, 1), false);
});
