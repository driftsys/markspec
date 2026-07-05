import { assertEquals } from "@std/assert";
import {
  type Action,
  INIT_CLIENT_IDS,
  type InitClientId,
  type ProfileChoice,
} from "./types.ts";

Deno.test("types: INIT_CLIENT_IDS contains the two init-supported clients", () => {
  assertEquals(INIT_CLIENT_IDS.length, 2);
  const set = new Set<InitClientId>(INIT_CLIENT_IDS);
  assertEquals(set.has("claude"), true);
  assertEquals(set.has("opencode"), true);
});

Deno.test("types: ProfileChoice discriminator narrows correctly", () => {
  const choices: ProfileChoice[] = [
    { kind: "bundled" },
    { kind: "git", spec: "git+https://example.invalid/p.git" },
    { kind: "local", spec: "./p" },
    { kind: "none" },
  ];
  for (const c of choices) {
    if (c.kind === "git" || c.kind === "local") {
      assertEquals(typeof c.spec, "string");
    }
  }
});

Deno.test("types: Action discriminator covers every kind", () => {
  const actions: Action[] = [
    { kind: "create", file: "x" },
    { kind: "merge", file: "x" },
    { kind: "overwrite", file: "x", reason: "force" },
    { kind: "skip", file: "x", reason: "exists" },
    { kind: "no-op", file: "x" },
  ];
  assertEquals(actions.length, 5);
});
