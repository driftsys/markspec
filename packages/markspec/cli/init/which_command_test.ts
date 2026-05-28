import { assertEquals } from "@std/assert";
import { parseWhichOutput } from "./which_command.ts";

Deno.test("parseWhichOutput: empty stdout with exit 0 → undefined", () => {
  assertEquals(parseWhichOutput(0, new Uint8Array(0)), undefined);
});

Deno.test("parseWhichOutput: whitespace-only stdout → undefined", () => {
  const stdout = new TextEncoder().encode("   \n");
  assertEquals(parseWhichOutput(0, stdout), undefined);
});

Deno.test("parseWhichOutput: blank first line, content later → undefined", () => {
  // Defensive: callers only look at line 1; blank line 1 still means no match.
  const stdout = new TextEncoder().encode("\n/usr/bin/markspec\n");
  assertEquals(parseWhichOutput(0, stdout), undefined);
});

Deno.test("parseWhichOutput: non-zero exit code → undefined", () => {
  const stdout = new TextEncoder().encode("/usr/bin/markspec\n");
  assertEquals(parseWhichOutput(1, stdout), undefined);
});

Deno.test("parseWhichOutput: posix path on first line → trimmed", () => {
  const stdout = new TextEncoder().encode("/usr/bin/markspec\n");
  assertEquals(parseWhichOutput(0, stdout), "/usr/bin/markspec");
});

Deno.test("parseWhichOutput: multi-line output → first line only", () => {
  // `where` on Windows can emit multiple matches; we use the first.
  const stdout = new TextEncoder().encode(
    "C:\\Program Files\\markspec\\markspec.exe\r\nC:\\other\\markspec.exe\r\n",
  );
  assertEquals(
    parseWhichOutput(0, stdout),
    "C:\\Program Files\\markspec\\markspec.exe",
  );
});
