import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

Deno.test("init --help snapshot", async (t) => {
  const { stdout } = await markspec(["init", "--help"]);
  await assertSnapshot(t, stdout);
});
