import { assert, assertEquals } from "@std/assert";
import { readEntryBody, replaceEntryBody } from "./entry_body.ts";

const FILE = "/p/doc.md";

const DOC = `# Doc

- [REQ_0001] First

  Body one line A.
  line B.

      Id: 01JBRK00000000000000000001

- [REQ_0002] Second

  Body two.

      Id: 01JBRK00000000000000000002
`;

const NO_BODY = `# Doc

- [REQ_0001] First

      Id: 01JBRK00000000000000000001
`;

Deno.test("readEntryBody: returns the dedented body", async () => {
  assertEquals(
    await readEntryBody(DOC, FILE, "REQ_0001"),
    "Body one line A.\nline B.",
  );
});

Deno.test("readEntryBody: empty string for an entry with no body", async () => {
  assertEquals(await readEntryBody(NO_BODY, FILE, "REQ_0001"), "");
});

Deno.test("readEntryBody: undefined for an unknown display ID", async () => {
  assertEquals(await readEntryBody(DOC, FILE, "REQ_9999"), undefined);
});

Deno.test("replaceEntryBody: replaces only the target body lines", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "New body.");
  assert(r.ok);
  assertEquals(
    r.text,
    DOC.replace("  Body one line A.\n  line B.", "  New body."),
  );
});

Deno.test("replaceEntryBody: keeps unformatted neighbours byte for byte", async () => {
  const messy = `# Doc

- [REQ_0001] First

  Body one.

      Id: 01JBRK00000000000000000001

- [REQ_0002]   Second   

  Body two with trailing spaces.   
  odd
     wrap here.

      Satisfies: REQ_0001
      Id: 01JBRK00000000000000000002
      Labels: b, a
`;
  const r = await replaceEntryBody(messy, FILE, "REQ_0001", "Other.");
  assert(r.ok);
  assertEquals(r.text, messy.replace("  Body one.", "  Other."));
  const tail = messy.slice(messy.indexOf("- [REQ_0002]"));
  assert(r.text.endsWith(tail));
});

Deno.test("replaceEntryBody: keeps CRLF line endings", async () => {
  const crlf = DOC.replaceAll("\n", "\r\n");
  const r = await replaceEntryBody(crlf, FILE, "REQ_0001", "New A.\nNew B.");
  assert(r.ok);
  assertEquals(
    r.text,
    crlf.replace(
      "  Body one line A.\r\n  line B.",
      "  New A.\r\n  New B.",
    ),
  );
  assertEquals(/(^|[^\r])\n/.test(r.text), false);
});

Deno.test("replaceEntryBody: keeps each line's own ending in a mixed file", async () => {
  // Title line of REQ_0001 uses CRLF; the rest of the file uses LF.
  const mixed = DOC.replace("- [REQ_0001] First\n", "- [REQ_0001] First\r\n")
    .replace(
      "      Id: 01JBRK00000000000000000002\n",
      "      Id: 01JBRK00000000000000000002\r\n",
    );
  const r = await replaceEntryBody(mixed, FILE, "REQ_0001", "X.\nY.");
  assert(r.ok);
  assertEquals(
    r.text,
    mixed.replace("  Body one line A.\n  line B.", "  X.\r\n  Y.\r"),
  );
});

Deno.test("replaceEntryBody: multi-paragraph body keeps blank lines unindented", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "A.\n\nB.");
  assert(r.ok);
  assertEquals(
    r.text,
    DOC.replace("  Body one line A.\n  line B.", "  A.\n\n  B."),
  );
});

Deno.test("replaceEntryBody: refuses a body that adds an entry line", async () => {
  const r = await replaceEntryBody(
    DOC,
    FILE,
    "REQ_0001",
    "Text.\n\n- [X_0001] Sneaky\n\n      Id: 01JBRK00000000000000000099",
  );
  assertEquals(r, { ok: false, refusal: "entries-changed" });
});

Deno.test("replaceEntryBody: refuses an empty or blank proposal", async () => {
  assertEquals(await replaceEntryBody(DOC, FILE, "REQ_0001", ""), {
    ok: false,
    refusal: "proposal-empty",
  });
  assertEquals(await replaceEntryBody(DOC, FILE, "REQ_0001", "  \n\n"), {
    ok: false,
    refusal: "proposal-empty",
  });
});

Deno.test("replaceEntryBody: refuses an entry with no body", async () => {
  assertEquals(await replaceEntryBody(NO_BODY, FILE, "REQ_0001", "New."), {
    ok: false,
    refusal: "body-empty",
  });
});

Deno.test("replaceEntryBody: refuses an unknown display ID", async () => {
  assertEquals(await replaceEntryBody(DOC, FILE, "REQ_9999", "New."), {
    ok: false,
    refusal: "entry-not-found",
  });
});

Deno.test("replaceEntryBody: front matter keeps file-relative lines", async () => {
  const fm = "---\ntitle: X\n---\n";
  const doc = fm + DOC;
  assertEquals(
    await readEntryBody(doc, FILE, "REQ_0002"),
    "Body two.",
  );
  const r = await replaceEntryBody(doc, FILE, "REQ_0002", "Changed.");
  assert(r.ok);
  assert(r.text.startsWith(fm));
  assertEquals(r.text, doc.replace("  Body two.", "  Changed."));
});

Deno.test("replaceEntryBody: indented entry uses its own body indent", async () => {
  // Only top-level list items are entries, so a list indented by two
  // spaces puts the marker at column 3 and the body indent at 4.
  const indented = `# Doc

  - [REQ_0003] Indented

    Body.

        Id: 01JBRK00000000000000000003
`;
  assertEquals(await readEntryBody(indented, FILE, "REQ_0003"), "Body.");
  const r = await replaceEntryBody(indented, FILE, "REQ_0003", "One.\n\nTwo.");
  assert(r.ok);
  assertEquals(
    r.text,
    indented.replace("    Body.", "    One.\n\n    Two."),
  );
});

Deno.test("replaceEntryBody: a soft-wrapped title is not part of the body", async () => {
  const wrapped = `# Doc

- [REQ_0001] A long title that
  wraps onto a second line

  Body text.

      Id: 01JBRK00000000000000000001
`;
  assertEquals(await readEntryBody(wrapped, FILE, "REQ_0001"), "Body text.");
  const r = await replaceEntryBody(wrapped, FILE, "REQ_0001", "New text.");
  assert(r.ok);
  assertEquals(r.text, wrapped.replace("  Body text.", "  New text."));
});

Deno.test("replaceEntryBody: refuses a body ending in a trailer-like line", async () => {
  const r = await replaceEntryBody(
    DOC,
    FILE,
    "REQ_0001",
    "New.\n\n    Satisfies: REQ_0002",
  );
  assertEquals(r, { ok: false, refusal: "entries-changed" });
});

const LAZY = `# Doc

- [REQ_0001] First

  Body line one
lazy continuation line.
  Still body.

      Id: 01JBRK00000000000000000001

- [REQ_0002] Second

  Body two.

      Id: 01JBRK00000000000000000002
`;

Deno.test("readEntryBody: includes a lazy continuation line", async () => {
  assertEquals(
    await readEntryBody(LAZY, FILE, "REQ_0001"),
    "Body line one\nlazy continuation line.\nStill body.",
  );
});

Deno.test("replaceEntryBody: replaces a body with a lazy continuation line", async () => {
  const r = await replaceEntryBody(LAZY, FILE, "REQ_0001", "NEW.");
  assert(r.ok);
  assertEquals(
    r.text,
    LAZY.replace(
      "  Body line one\nlazy continuation line.\n  Still body.",
      "  NEW.",
    ),
  );
});

Deno.test("replaceEntryBody: a lone CR in the proposal becomes a line break", async () => {
  const r = await replaceEntryBody(DOC, FILE, "REQ_0001", "A.\rB.");
  assert(r.ok);
  assertEquals(
    r.text,
    DOC.replace("  Body one line A.\n  line B.", "  A.\n  B."),
  );
  assertEquals(await readEntryBody(r.text, FILE, "REQ_0002"), "Body two.");
});

Deno.test("replaceEntryBody: a file with lone CR line endings keeps them", async () => {
  const cr = DOC.replaceAll("\n", "\r");
  assertEquals(
    await readEntryBody(cr, FILE, "REQ_0001"),
    "Body one line A.\nline B.",
  );
  assertEquals(await readEntryBody(cr, FILE, "REQ_0002"), "Body two.");
  const r = await replaceEntryBody(cr, FILE, "REQ_0002", "Z.\nY.");
  assert(r.ok);
  assertEquals(r.text, cr.replace("  Body two.", "  Z.\r  Y."));
});
