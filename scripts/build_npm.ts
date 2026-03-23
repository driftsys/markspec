/**
 * Build script for npm package using dnt (Deno to Node Transform).
 *
 * Usage: deno run -A scripts/build_npm.ts [version]
 *
 * If no version is provided, reads from packages/markspec/deno.json.
 */

import { build, emptyDir } from "@deno/dnt";

const denoJson = JSON.parse(
  await Deno.readTextFile("packages/markspec/deno.json"),
);
const raw = Deno.args[0] ?? denoJson.version;
const version = raw.replace(/^v/, "");

await emptyDir("./npm");

await build({
  entryPoints: ["./packages/markspec/core/mod.ts"],
  outDir: "./npm",
  shims: {
    deno: false,
  },
  typeCheck: false,
  test: false,
  importMap: "./packages/markspec/deno.json",
  package: {
    name: "@driftsys/markspec",
    version,
    description:
      "Markdown flavor and toolchain for traceable industrial documentation",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/driftsys/markspec.git",
    },
    bugs: {
      url: "https://github.com/driftsys/markspec/issues",
    },
    homepage: "https://driftsys.github.io/markspec/",
    keywords: [
      "markdown",
      "requirements",
      "traceability",
      "iso-26262",
      "aspice",
      "documentation",
    ],
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
