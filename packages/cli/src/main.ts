const USAGE =
  `markspec — Markdown flavor and toolchain for traceable industrial documentation

Usage:
  markspec doc build <file>       Generate document PDF
  markspec doc export             JSON export
  markspec doc validate           Check ID graph, gaps, broken links
  markspec doc format             Format Markdown, assign ULIDs
  markspec doc insert             Scaffold a new requirement block

  markspec book build             Generate PDF + HTML book
  markspec book dev               Live preview

  markspec deck build <file>      Generate presentation PDF
  markspec deck dev <file>        Live preview

  markspec lsp                    Start LSP server
  markspec mcp                    Start MCP server

  markspec --version              Print version
  markspec --help                 Print this help
`;

if (import.meta.main) {
  const args = Deno.args;
  if (args.length === 0 || args.includes("--help")) {
    console.log(USAGE);
    Deno.exit(0);
  }
  if (args.includes("--version")) {
    console.log("markspec 0.0.1");
    Deno.exit(0);
  }
  console.error(
    "markspec: not yet implemented. Run 'markspec --help' for usage.",
  );
  Deno.exit(1);
}
