/**
 * #712: `markspec fmt` loads the dprint Markdown plugin only when a Markdown
 * file is in scope. Read access to the plugin's WASM file is denied, so a
 * load attempt fails: a source-only run must still succeed, and a Markdown
 * run (the control) must fail.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { markspec } from "./helpers.ts";

/** Absolute path of the dprint Markdown plugin in the Deno npm cache. */
async function dprintPluginPath(): Promise<string> {
  const { stdout } = await new Deno.Command("deno", {
    args: ["info", "--json"],
    stdout: "piped",
    stderr: "null",
  }).output();
  const { npmCache } = JSON.parse(new TextDecoder().decode(stdout)) as {
    npmCache: string;
  };
  return join(
    npmCache,
    "registry.npmjs.org",
    "@dprint",
    "markdown",
    "0.20.0",
    "plugin.wasm",
  );
}

const PROJECT_FILES = {
  ".markspec.yaml": "{}\n",
  "main.rs": "/// A doc comment.\nfn main() {}\n",
  "README.md": "# Title\n\nSome prose.\n",
};

Deno.test("fmt: a source-only run does not load the Markdown formatter (#712)", async () => {
  const deny = `--deny-read=${await dprintPluginPath()}`;
  const { code, stderr } = await markspec(["fmt", "--check", "main.rs"], {
    files: PROJECT_FILES,
    permissions: [deny],
  });
  assertEquals(code, 0, stderr);
});

Deno.test("fmt: a Markdown run still loads the Markdown formatter (#712 control)", async () => {
  const deny = `--deny-read=${await dprintPluginPath()}`;
  const { code } = await markspec(["fmt", "--check", "README.md"], {
    files: PROJECT_FILES,
    permissions: [deny],
  });
  assertNotEquals(code, 0);
});
