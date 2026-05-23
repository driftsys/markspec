import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  CaptionNode,
  CodeNode,
  InlineContent,
  ParagraphNode,
  SourceRange,
} from "./nodes.ts";

const R: SourceRange = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 2 },
};

Deno.test("nodes: InlineContent carries verbatim text", () => {
  const ic: InlineContent = {
    text: "The system shall read $Sensor.",
  };
  assertEquals(ic.text, "The system shall read $Sensor.");
});

Deno.test("nodes: block union is discriminated and exhaustive", () => {
  const para: ParagraphNode = {
    kind: "paragraph",
    content: { text: "x" },
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
