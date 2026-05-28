import { assertEquals, assertRejects } from "@std/assert";
import {
  parseProfileSpec,
  type Prompter,
  runProfilePicker,
} from "./profile_picker.ts";

Deno.test("parseProfileSpec: bundled keyword", () => {
  assertEquals(parseProfileSpec("bundled"), { kind: "bundled" });
});

Deno.test("parseProfileSpec: false keyword maps to none", () => {
  assertEquals(parseProfileSpec("false"), { kind: "none" });
});

Deno.test("parseProfileSpec: git+https URL", () => {
  const spec = "git+https://github.com/org/p.git";
  assertEquals(parseProfileSpec(spec), { kind: "git", spec });
});

Deno.test("parseProfileSpec: git+ssh URL", () => {
  const spec = "git+ssh://git@github.com/org/p.git";
  assertEquals(parseProfileSpec(spec), { kind: "git", spec });
});

Deno.test("parseProfileSpec: relative local path", () => {
  assertEquals(parseProfileSpec("./profiles/aspice"), {
    kind: "local",
    spec: "./profiles/aspice",
  });
});

Deno.test("parseProfileSpec: absolute local path", () => {
  assertEquals(parseProfileSpec("/etc/markspec/p"), {
    kind: "local",
    spec: "/etc/markspec/p",
  });
});

Deno.test("parseProfileSpec: rejects garbage", () => {
  assertEquals(parseProfileSpec("nonsense"), undefined);
  assertEquals(parseProfileSpec(""), undefined);
});

Deno.test("runProfilePicker: enter selects bundled", async () => {
  const prompter: Prompter = {
    question: () => Promise.resolve(""),
  };
  const choice = await runProfilePicker(prompter);
  assertEquals(choice, { kind: "bundled" });
});

Deno.test("runProfilePicker: choice 1 selects bundled", async () => {
  const prompter: Prompter = {
    question: () => Promise.resolve("1"),
  };
  assertEquals(await runProfilePicker(prompter), { kind: "bundled" });
});

Deno.test("runProfilePicker: choice 4 confirms core-only with y", async () => {
  const answers = ["4", "y"];
  const prompter: Prompter = {
    question: () => Promise.resolve(answers.shift()!),
  };
  assertEquals(await runProfilePicker(prompter), { kind: "none" });
});

Deno.test("runProfilePicker: choice 4 rejected at confirm goes back to menu", async () => {
  const answers = ["4", "n", "1"];
  const prompter: Prompter = {
    question: () => Promise.resolve(answers.shift()!),
  };
  assertEquals(await runProfilePicker(prompter), { kind: "bundled" });
});

Deno.test("runProfilePicker: choice 2 then git URL", async () => {
  const answers = ["2", "git+https://github.com/o/p.git"];
  const prompter: Prompter = {
    question: () => Promise.resolve(answers.shift()!),
  };
  assertEquals(await runProfilePicker(prompter), {
    kind: "git",
    spec: "git+https://github.com/o/p.git",
  });
});

Deno.test("runProfilePicker: gives up after 3 invalid inputs", async () => {
  const answers = ["x", "y", "z"];
  const prompter: Prompter = {
    question: () => Promise.resolve(answers.shift() ?? ""),
  };
  await assertRejects(() => runProfilePicker(prompter), Error, "max attempts");
});

Deno.test("runProfilePicker: null from prompter (EOF / Ctrl-D) aborts", async () => {
  // Pressing Ctrl-D before answering must not silently scaffold the
  // bundled default — it has to surface as an abort the CLI can
  // exit non-zero on. Empty string `""` (plain Enter) keeps its
  // existing meaning of "use bundled default".
  const prompter: Prompter = {
    question: () => Promise.resolve(null),
  };
  await assertRejects(
    () => runProfilePicker(prompter),
    Error,
    "aborted by user",
  );
});

Deno.test("runProfilePicker: null on sub-prompt (e.g. mid Git URL) aborts", async () => {
  // EOF mid-flow on a follow-up prompt must abort, not loop back.
  const answers: Array<string | null> = ["2", null];
  let i = 0;
  const prompter: Prompter = {
    question: () => Promise.resolve(answers[i++]),
  };
  await assertRejects(
    () => runProfilePicker(prompter),
    Error,
    "aborted by user",
  );
});
