const USAGE =
  `markspec — Markdown flavor and toolchain for traceable industrial documentation

Usage:
  markspec format                 Stamp ULIDs, fix indentation, normalize attributes
  markspec validate               Check broken refs, missing Ids, duplicates
  markspec compile <paths>        Parse files, build traceability graph, output JSON
  markspec export                 Compiled JSON → json, csv, reqif, yaml
  markspec insert                 Scaffold a new requirement block

  markspec doc build <file>       Generate document PDF
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
