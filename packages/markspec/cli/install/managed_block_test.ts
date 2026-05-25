import { assertEquals } from "@std/assert";
import {
  applyLuaBlock,
  LUA_FENCE_CLOSE,
  LUA_FENCE_OPEN,
  removeLuaBlock,
} from "./managed_block.ts";

const FENCE_OPEN = "-- >>> markspec (managed) >>>";
const FENCE_CLOSE = "-- <<< markspec (managed) <<<";

Deno.test("LUA_FENCE constants match spec §6.1", () => {
  assertEquals(LUA_FENCE_OPEN, FENCE_OPEN);
  assertEquals(LUA_FENCE_CLOSE, FENCE_CLOSE);
});

Deno.test("applyLuaBlock: empty file → adds block at end", () => {
  const result = applyLuaBlock("", "require('lspconfig').markspec.setup({})");
  assertEquals(
    result,
    `${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n`,
  );
});

Deno.test("applyLuaBlock: existing content, no block → appends block", () => {
  const input = "-- user's own config\nrequire('plugin').setup()\n";
  const result = applyLuaBlock(
    input,
    "require('lspconfig').markspec.setup({})",
  );
  assertEquals(
    result,
    `${input}\n${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n`,
  );
});

Deno.test(
  "applyLuaBlock: existing block with same content → idempotent (byte-identical)",
  () => {
    const block =
      `${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n`;
    const input = `-- prelude\n\n${block}-- epilogue\n`;
    const result = applyLuaBlock(
      input,
      "require('lspconfig').markspec.setup({})",
    );
    assertEquals(result, input);
  },
);

Deno.test(
  "applyLuaBlock: existing block with different content → replaces region only",
  () => {
    const oldBlock =
      `${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({ old = true })\n${FENCE_CLOSE}\n`;
    const input = `-- prelude\n\n${oldBlock}-- epilogue\n`;
    const result = applyLuaBlock(
      input,
      "require('lspconfig').markspec.setup({})",
    );
    const expected =
      `-- prelude\n\n${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n-- epilogue\n`;
    assertEquals(result, expected);
  },
);

Deno.test("applyLuaBlock: handles multi-line content correctly", () => {
  const content =
    `require('lspconfig').markspec.setup({\n  cmd = { 'markspec', 'lsp' },\n})`;
  const result = applyLuaBlock("", content);
  assertEquals(result, `${FENCE_OPEN}\n${content}\n${FENCE_CLOSE}\n`);
});

Deno.test("removeLuaBlock: removes the fenced region cleanly", () => {
  const block = `${FENCE_OPEN}\nfoo\n${FENCE_CLOSE}\n`;
  const input = `-- prelude\n\n${block}-- epilogue\n`;
  const result = removeLuaBlock(input);
  assertEquals(result, "-- prelude\n-- epilogue\n");
});

Deno.test("removeLuaBlock: no block present → input unchanged", () => {
  const input = "-- just user content\n";
  assertEquals(removeLuaBlock(input), input);
});

Deno.test("removeLuaBlock: removes trailing newline that was the separator", () => {
  const block = `${FENCE_OPEN}\nfoo\n${FENCE_CLOSE}\n`;
  const input = `prelude\n${block}`;
  const result = removeLuaBlock(input);
  assertEquals(result, "prelude\n");
});

// --- Extra edge cases ---

Deno.test("removeLuaBlock: block at end of file with no epilogue", () => {
  const block = `${FENCE_OPEN}\nfoo\n${FENCE_CLOSE}\n`;
  const input = `-- prelude\n\n${block}`;
  const result = removeLuaBlock(input);
  assertEquals(result, "-- prelude\n");
});

Deno.test("removeLuaBlock: block is entire file content", () => {
  const block = `${FENCE_OPEN}\nfoo\n${FENCE_CLOSE}\n`;
  const result = removeLuaBlock(block);
  assertEquals(result, "");
});

Deno.test("applyLuaBlock: block at end of file (no epilogue) → idempotent", () => {
  const block =
    `${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n`;
  const input = `-- prelude\n\n${block}`;
  const result = applyLuaBlock(
    input,
    "require('lspconfig').markspec.setup({})",
  );
  assertEquals(result, input);
});

Deno.test(
  "applyLuaBlock: existing content without trailing newline → appends block after newline",
  () => {
    // File content that does not end with \n — e.g., freshly created without trailing newline
    const input = "-- user config";
    const result = applyLuaBlock(
      input,
      "require('lspconfig').markspec.setup({})",
    );
    assertEquals(
      result,
      `-- user config\n\n${FENCE_OPEN}\nrequire('lspconfig').markspec.setup({})\n${FENCE_CLOSE}\n`,
    );
  },
);

Deno.test("applyLuaBlock: empty string content inside block is valid", () => {
  // Edge: installing an empty managed block (e.g., placeholder)
  const result = applyLuaBlock("", "");
  assertEquals(result, `${FENCE_OPEN}\n\n${FENCE_CLOSE}\n`);
});

Deno.test("removeLuaBlock: empty file → empty file", () => {
  assertEquals(removeLuaBlock(""), "");
});

Deno.test("removeLuaBlock: trims trailing blank line before block (#480)", () => {
  const block = `${FENCE_OPEN}\nfoo\n${FENCE_CLOSE}\n`;
  const input = `-- config\n\n${block}`;
  const result = removeLuaBlock(input);
  assertEquals(result, "-- config\n");
});
