import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  CaptionNode,
  CodeNode,
  EntityRefMarker,
  InlineContent,
  ModalMarker,
  ParagraphNode,
  SourceRange,
} from "./nodes.ts";

const R: SourceRange = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 2 },
};

Deno.test("nodes: InlineContent carries text + typed markers", () => {
  const modal: ModalMarker = {
    kind: "modal",
    cls: "rfc2119",
    canonical: "shall",
    range: R,
  };
  const ent: EntityRefMarker = {
    kind: "entity",
    ident: "$Sensor",
    convention: "type",
    range: R,
  };
  const ic: InlineContent = {
    text: "The system shall read $Sensor.",
    markers: [modal, ent],
  };
  assertEquals(ic.markers.length, 2);
  assertEquals(ic.markers[0].kind, "modal");
  assertEquals(ic.markers[1].kind, "entity");
});

Deno.test("nodes: block union is discriminated and exhaustive", () => {
  const para: ParagraphNode = {
    kind: "paragraph",
    content: { text: "x", markers: [] },
    range: R,
  };
  const code: CodeNode = {
    kind: "code",
    lang: "rust",
    text: "fn main() {}",
    range: R,
  };
  const cap: CaptionNode = {
    kind: "caption",
    keyword: "Figure",
    text: "A diagram",
    position: "below",
    range: R,
  };

  const label = (b: BodyBlock): string => {
    switch (b.kind) {
      case "paragraph":
        return "paragraph";
      case "list":
        return "list";
      case "table":
        return "table";
      case "figure":
        return "figure";
      case "code":
        return "code";
      case "feature":
        return "feature";
      case "math":
        return "math";
      case "definition-list":
        return "definition-list";
      case "note":
        return "note";
      case "blockquote":
        return "blockquote";
      case "caption":
        return "caption";
      case "unknown":
        return "unknown";
      default: {
        const _exhaustive: never = b;
        return _exhaustive;
      }
    }
  };

  assertEquals(label(para), "paragraph");
  assertEquals(label(code), "code");
  assertEquals(label(cap), "caption");
});
