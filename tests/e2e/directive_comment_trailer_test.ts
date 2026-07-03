import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

Deno.test("check: no-space directive comment before trailer is not MSL-P022 (#687)", async () => {
  const input = `# Doc

- [STK_0001] Title

  Body prose within 200 ms.

  <!--markspec:pending Q-001-->

      Id: ${ULID}
`;
  const { code, stderr } = await markspec(["check", "req.md"], {
    "req.md": input,
  });
  assertEquals(code, 0);
  assertEquals(stderr.includes("MSL-P022"), false);
});
