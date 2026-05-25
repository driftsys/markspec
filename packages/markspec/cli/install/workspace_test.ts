import { assertEquals } from "@std/assert";
import { findWorkspaceRoot } from "./workspace.ts";

Deno.test("findWorkspaceRoot: empty startDir terminates with undefined", async () => {
  const result = await findWorkspaceRoot("");
  // Empty startDir leads to dirname("") === "." → dirname(".") === "." → returns undefined.
  // Using assertEquals catches the test in a timeout if it actually loops.
  assertEquals(result, undefined);
});

Deno.test("findWorkspaceRoot: finds markspec.yaml", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/markspec.yaml`, "");
  try {
    assertEquals(await findWorkspaceRoot(tmp), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("findWorkspaceRoot: finds .markspec.yaml", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/.markspec.yaml`, "");
  try {
    assertEquals(await findWorkspaceRoot(tmp), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("findWorkspaceRoot: finds project.yaml", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/project.yaml`, "");
  try {
    assertEquals(await findWorkspaceRoot(tmp), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("findWorkspaceRoot: walks up to parent", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.mkdir(`${tmp}/sub/deeper`, { recursive: true });
  await Deno.writeTextFile(`${tmp}/project.yaml`, "");
  try {
    assertEquals(await findWorkspaceRoot(`${tmp}/sub/deeper`), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("findWorkspaceRoot: returns undefined when none found", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    assertEquals(await findWorkspaceRoot(tmp), undefined);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("findWorkspaceRoot: both markers in same dir — finds the dir", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/markspec.yaml`, "");
  await Deno.writeTextFile(`${tmp}/project.yaml`, "");
  try {
    assertEquals(await findWorkspaceRoot(tmp), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
