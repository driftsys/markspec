import { assertEquals, assertExists } from "@std/assert";
import { markspec } from "./helpers.ts";

const ADR_017_FIXTURE = {
  "project.yaml": `name: discipline-test\nversion: 0.1.0\n`,
  "requirements.md": `# Requirements

- [REQ_0001] Brake controller debounces pedal input

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Allocated-to: SWC_0001

- [SWC_0001] Brake controller software

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: SoftwareComponent

- [REQ_0002] Brake actuator delivers force within 12kN

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Allocated-to: HWC_0001

- [HWC_0001] Brake hydraulic actuator

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEI
      Type: HardwareComponent

- [REQ_0003] Vehicle stops within regulatory distance

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEJ
`,
};

Deno.test("discipline classifier emits derivedDiscipline on every compiled entry", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "requirements.md"],
    ADR_017_FIXTURE,
  );

  assertEquals(code, 0);

  const compiled = JSON.parse(stdout);
  // Compiled output shape: { entries: Record<displayId, Entry>, links: [...], ... }
  const byId = compiled.entries as Record<
    string,
    { derivedDiscipline?: string }
  >;

  // Channel 3 (type-based) — Type: SoftwareComponent → "software"
  assertEquals(byId["SWC_0001"].derivedDiscipline, "software");
  // Channel 3 — Type: HardwareComponent → "hardware"
  assertEquals(byId["HWC_0001"].derivedDiscipline, "hardware");
  // Channel 4 (allocation-based) — REQ_0001 Allocated-to SWC_0001 → "software"
  assertEquals(byId["REQ_0001"].derivedDiscipline, "software");
  // Channel 4 — REQ_0002 Allocated-to HWC_0001 → "hardware"
  assertEquals(byId["REQ_0002"].derivedDiscipline, "hardware");
  // Default — REQ_0003 has no allocation and no discipline-bearing Type
  assertEquals(byId["REQ_0003"].derivedDiscipline, "system");
  // Field is always present on every entry
  for (const e of Object.values(byId)) {
    assertExists(e.derivedDiscipline);
  }
});
