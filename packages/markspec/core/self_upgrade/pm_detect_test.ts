import { assertEquals } from "@std/assert";
import { classifyInstallPath } from "./pm_detect.ts";

const HOME_POSIX = "/Users/alice";
const HOME_WIN = "C:\\Users\\Alice";

Deno.test("classifyInstallPath: ~/.local/bin → user-local", () => {
  const r = classifyInstallPath("/Users/alice/.local/bin/markspec", HOME_POSIX);
  assertEquals(r.source, "user-local");
});

Deno.test("classifyInstallPath: ~/.cargo/bin → user-local", () => {
  assertEquals(
    classifyInstallPath("/Users/alice/.cargo/bin/markspec", HOME_POSIX).source,
    "user-local",
  );
});

Deno.test("classifyInstallPath: ~/bin → user-local", () => {
  assertEquals(
    classifyInstallPath("/Users/alice/bin/markspec", HOME_POSIX).source,
    "user-local",
  );
});

Deno.test("classifyInstallPath: brew Cellar realpath → homebrew", () => {
  const r = classifyInstallPath(
    "/opt/homebrew/Cellar/markspec/0.6.1/bin/markspec",
    HOME_POSIX,
  );
  assertEquals(r.source, "homebrew");
  assertEquals(r.hintCommand, "brew upgrade markspec");
});

Deno.test("classifyInstallPath: brew x86 Cellar (Intel macOS) → homebrew", () => {
  assertEquals(
    classifyInstallPath(
      "/usr/local/Cellar/markspec/0.6.1/bin/markspec",
      HOME_POSIX,
    ).source,
    "homebrew",
  );
});

Deno.test("classifyInstallPath: /opt/homebrew/bin (no Cellar resolved) → homebrew", () => {
  // Even without realpath resolving to Cellar, /opt/homebrew/ on its own
  // is a brew prefix and should be flagged.
  assertEquals(
    classifyInstallPath("/opt/homebrew/bin/markspec", HOME_POSIX).source,
    "homebrew",
  );
});

Deno.test("classifyInstallPath: npm node_modules → npm", () => {
  const r = classifyInstallPath(
    "/Users/alice/project/node_modules/.bin/markspec",
    HOME_POSIX,
  );
  assertEquals(r.source, "npm");
  assertEquals(r.hintCommand, "npm update -g markspec");
});

Deno.test("classifyInstallPath: nvm prefix → npm", () => {
  assertEquals(
    classifyInstallPath(
      "/Users/alice/.nvm/versions/node/v20.0.0/bin/markspec",
      HOME_POSIX,
    ).source,
    "npm",
  );
});

Deno.test("classifyInstallPath: /usr/bin (no brew indicator) → system", () => {
  const r = classifyInstallPath("/usr/bin/markspec", HOME_POSIX);
  assertEquals(r.source, "system");
});

Deno.test("classifyInstallPath: /usr/local/bin (no Cellar) → system", () => {
  assertEquals(
    classifyInstallPath("/usr/local/bin/markspec", HOME_POSIX).source,
    "system",
  );
});

Deno.test("classifyInstallPath: /snap → system", () => {
  assertEquals(
    classifyInstallPath("/snap/markspec/current/markspec", HOME_POSIX).source,
    "system",
  );
});

Deno.test("classifyInstallPath: random tmp path → unknown", () => {
  assertEquals(
    classifyInstallPath("/tmp/markspec-test-12345/markspec", HOME_POSIX).source,
    "unknown",
  );
});

Deno.test("classifyInstallPath: Windows %LOCALAPPDATA% → user-local", () => {
  assertEquals(
    classifyInstallPath(
      "C:\\Users\\Alice\\.local\\bin\\markspec.exe",
      HOME_WIN,
    ).source,
    "user-local",
  );
});
