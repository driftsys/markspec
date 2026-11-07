import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { doctorCmd } from "./doctor.ts";

for (const format of ["text", "json"]) {
  Deno.test(`doctor: invalid lockfile preserves parse diagnostics in ${format}`, async () => {
    const dir = await Deno.makeTempDir();
    const previousCwd = Deno.cwd();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitSignal = new Error("doctor exit");
    let exitCode: number | undefined;
    try {
      await Deno.writeTextFile(
        `${dir}/project.yaml`,
        "name: doctor-unit\nversion: '0.0.0'\n",
      );
      await Deno.writeTextFile(`${dir}/markspec.lock`, "schema = 1\n");
      Deno.chdir(dir);
      using _log = stub(console, "log", (line: string) => stdout.push(line));
      using _error = stub(
        console,
        "error",
        (line: string) => stderr.push(line),
      );
      using _exit = stub(Deno, "exit", (code?: number): never => {
        exitCode = code;
        throw exitSignal;
      });
      try {
        await doctorCmd.parse(["--format", format]);
      } catch (error) {
        if (error !== exitSignal) throw error;
      }
      assertEquals(exitCode, 2);
      const message = "Missing [meta] table or `locked-at` field";
      if (format === "json") {
        const output = JSON.parse(stdout.join("\n"));
        assertEquals(output.lockfile, { present: true });
        assertEquals(output.diagnostics, [{
          severity: "warning",
          code: "MSL-L001",
          message,
        }]);
      } else {
        assertEquals(stdout, []);
        assertStringIncludes(
          stderr.join("\n"),
          `warning[MSL-L001]: ${message}`,
        );
        assertEquals(stderr.join("\n").includes("edges in sync"), false);
      }
    } finally {
      Deno.chdir(previousCwd);
      await Deno.remove(dir, { recursive: true });
    }
  });
}
