import { assertEquals } from "@std/assert";
import { createMemFs } from "../fake_fs.ts";
import {
  EXTENSION_ID,
  mergeVscodeExtensions,
  scaffoldVscodeExtensions,
} from "./vscode_extensions.ts";

Deno.test("EXTENSION_ID is the published id", () => {
  assertEquals(EXTENSION_ID, "driftsys.markspec-ide");
});

Deno.test("mergeVscodeExtensions: returns null when existing already has the id", () => {
  const result = mergeVscodeExtensions(
    JSON.stringify(
      { recommendations: ["driftsys.markspec-ide", "other.ext"] },
      null,
      2,
    ),
  );
  assertEquals(result, null);
});

Deno.test("mergeVscodeExtensions: appends id when missing, preserves others", () => {
  const result = mergeVscodeExtensions(
    JSON.stringify({ recommendations: ["other.ext"] }, null, 2),
  );
  const parsed = JSON.parse(result!);
  assertEquals(parsed.recommendations, ["other.ext", "driftsys.markspec-ide"]);
});

Deno.test("mergeVscodeExtensions: preserves unwantedRecommendations and other keys", () => {
  const result = mergeVscodeExtensions(
    JSON.stringify(
      {
        recommendations: ["a.b"],
        unwantedRecommendations: ["bad.ext"],
        customKey: { nested: true },
      },
      null,
      2,
    ),
  );
  const parsed = JSON.parse(result!);
  assertEquals(parsed.unwantedRecommendations, ["bad.ext"]);
  assertEquals(parsed.customKey, { nested: true });
});

Deno.test("mergeVscodeExtensions: throws on malformed JSON", () => {
  let threw = false;
  try {
    mergeVscodeExtensions("{ broken json");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("scaffoldVscodeExtensions: creates file with the id when absent", async () => {
  const fs = createMemFs();
  const action = await scaffoldVscodeExtensions(fs, "/r");
  assertEquals(action, "create");
  const parsed = JSON.parse((await fs.read("/r/.vscode/extensions.json"))!);
  assertEquals(parsed.recommendations, ["driftsys.markspec-ide"]);
});

Deno.test("scaffoldVscodeExtensions: merges into existing file", async () => {
  const fs = createMemFs();
  await fs.write(
    "/r/.vscode/extensions.json",
    JSON.stringify({ recommendations: ["other.ext"] }, null, 2),
  );
  const action = await scaffoldVscodeExtensions(fs, "/r");
  assertEquals(action, "merge");
  const parsed = JSON.parse((await fs.read("/r/.vscode/extensions.json"))!);
  assertEquals(parsed.recommendations, ["other.ext", "driftsys.markspec-ide"]);
});

Deno.test("scaffoldVscodeExtensions: no-op when id already present", async () => {
  const fs = createMemFs();
  const existing = JSON.stringify(
    { recommendations: ["driftsys.markspec-ide"] },
    null,
    2,
  );
  await fs.write("/r/.vscode/extensions.json", existing);
  const action = await scaffoldVscodeExtensions(fs, "/r");
  assertEquals(action, "no-op");
  assertEquals(await fs.read("/r/.vscode/extensions.json"), existing);
});

Deno.test("scaffoldVscodeExtensions: skips with malformed-json reason", async () => {
  const fs = createMemFs();
  await fs.write("/r/.vscode/extensions.json", "{ broken");
  const action = await scaffoldVscodeExtensions(fs, "/r");
  assertEquals(action, "skip:malformed-json");
});
