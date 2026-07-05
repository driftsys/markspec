import { assertEquals, assertStringIncludes } from "@std/assert";

// Blackbox: drives the CLI binary via Deno.Command. Imports nothing from
// source modules (the e2e boundary). Recomputes CLI_ENTRY rather than
// reusing helpers.ts's markspec() because this test needs a pre-created
// FIFO config file and a custom env var, which that helper does not expose.
const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

/**
 * #634 — `markspec mcp install` must never hang silently. A config file
 * that blocks on read (here a FIFO with no writer — `readTextFile` parks
 * in the `open()`/`read()` syscall exactly as the reported host stall did)
 * must trip the install watchdog: a stderr diagnostic and a non-zero exit,
 * not an uninterruptible hang.
 *
 * FIFOs are POSIX-only; skip on Windows (the watchdog logic itself is
 * covered cross-platform by cli/install/deadline_test.ts).
 */
Deno.test({
  name:
    "mcp install: a read-stalled .mcp.json trips the watchdog (diagnostic + exit 1), not a hang",
  ignore: Deno.build.os === "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const fifo = `${dir}/.mcp.json`;
      const mk = await new Deno.Command("mkfifo", { args: [fifo] }).output();
      assertEquals(mk.code, 0, "mkfifo should create the FIFO");

      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          CLI_ENTRY,
          "mcp",
          "install",
          "--client",
          "claude",
          "--print",
          "--no-color",
        ],
        cwd: dir,
        // Short deadline keeps the test fast; merged with the parent env,
        // so PATH etc. are inherited.
        env: { MARKSPEC_INSTALL_TIMEOUT_MS: "500" },
        stdout: "piped",
        stderr: "piped",
      });
      const { code, stderr } = await cmd.output();
      const err = new TextDecoder().decode(stderr);

      assertEquals(code, 1, `expected exit 1, got ${code}; stderr:\n${err}`);
      assertStringIncludes(err, "timed out");
      // The diagnostic must name the workaround so a stuck user is unblocked.
      assertStringIncludes(err, "claude mcp add");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

/**
 * #634, write path — with `--force`, the config is staged to
 * `<config>.tmp` before an atomic rename. A write that blocks (a FIFO at
 * the tmp path with no reader — `writeConfigText` parks in `open()`) must
 * trip the watchdog too, not hang. POSIX-only.
 */
Deno.test({
  name:
    "mcp install --force: a write-stalled .mcp.json.tmp trips the watchdog (diagnostic + exit 1)",
  ignore: Deno.build.os === "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      // The atomic-write staging path is `<configPath>.tmp`; make it a
      // FIFO so the write blocks on open().
      const fifo = `${dir}/.mcp.json.tmp`;
      const mk = await new Deno.Command("mkfifo", { args: [fifo] }).output();
      assertEquals(mk.code, 0, "mkfifo should create the tmp FIFO");

      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          CLI_ENTRY,
          "mcp",
          "install",
          "--client",
          "claude",
          "--force",
          "--no-color",
        ],
        cwd: dir,
        env: { MARKSPEC_INSTALL_TIMEOUT_MS: "500" },
        stdout: "piped",
        stderr: "piped",
      });
      const { code, stderr } = await cmd.output();
      const err = new TextDecoder().decode(stderr);

      assertEquals(code, 1, `expected exit 1, got ${code}; stderr:\n${err}`);
      assertStringIncludes(err, "timed out");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
