import { assertEquals } from "@std/assert";
import { buildBodyAst } from "./build.ts";
import { render } from "./render.ts";
import { normalizeBodyAst } from "./normalize.ts";

function rt(s: string): string {
  return render(normalizeBodyAst(buildBodyAst(s)));
}

Deno.test("normalizeBodyAst: RFC-2119 modal lowercased mid-sentence", () => {
  assertEquals(
    rt("The driver SHALL debounce inputs."),
    "The driver shall debounce inputs.",
  );
});

Deno.test("normalizeBodyAst: sentence-initial EARS keeps capitalization", () => {
  assertEquals(
    rt("When speed exceeds the limit the system SHALL warn."),
    "When speed exceeds the limit the system shall warn.",
  );
});

Deno.test("normalizeBodyAst: idempotent", () => {
  const once = normalizeBodyAst(buildBodyAst("The system MUST stop."));
  const twice = normalizeBodyAst(once);
  assertEquals(render(twice), render(once));
  assertEquals(render(once), "The system must stop.");
});

Deno.test("normalizeBodyAst: total — no-modal prose unchanged", () => {
  assertEquals(
    rt("Plain prose with no modal keyword."),
    "Plain prose with no modal keyword.",
  );
});

Deno.test("normalizeBodyAst: modal inside a note normalized", () => {
  assertEquals(
    rt("> [!NOTE]\n> The driver SHALL act."),
    "> [!NOTE]\n> The driver shall act.",
  );
});

Deno.test("normalizeBodyAst: already-canonical body is a no-op", () => {
  const s = "The driver shall debounce inputs.";
  assertEquals(rt(s), s);
});

Deno.test("normalizeBodyAst: modal inside a list item normalized", () => {
  assertEquals(rt("- The driver SHALL act.\n- Plain item."),
    "- The driver shall act.\n- Plain item.");
});

Deno.test("normalizeBodyAst: modal inside a definition-list definition normalized", () => {
  assertEquals(rt("Term\n: The system MUST stop."),
    "Term\n: The system must stop.");
});
