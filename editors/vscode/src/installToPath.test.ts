import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import {
  type InstallPlan,
  isDirOnPath,
  pathHint,
  performCopy,
  planInstall,
} from "./installToPath";

const EXT_PATH = "/fake/extensions/driftsys.markspec-ide-0.0.1";
const HOME = "/home/dev";

test("planInstall: darwin → markspec, chmod true", () => {
  const p = planInstall({
    platform: "darwin",
    homedir: HOME,
    extensionPath: EXT_PATH,
  });
  assert.equal(p.binaryName, "markspec");
  assert.equal(p.source, path.join(EXT_PATH, "bin", "markspec"));
  assert.equal(p.targetDir, path.join(HOME, ".local", "bin"));
  assert.equal(p.target, path.join(HOME, ".local", "bin", "markspec"));
  assert.equal(p.chmod, true);
});

test("planInstall: linux → same shape as darwin", () => {
  const p = planInstall({
    platform: "linux",
    homedir: HOME,
    extensionPath: EXT_PATH,
  });
  assert.equal(p.binaryName, "markspec");
  assert.equal(p.chmod, true);
});

test("planInstall: win32 → markspec.exe, chmod false", () => {
  const p = planInstall({
    platform: "win32",
    homedir: HOME,
    extensionPath: EXT_PATH,
  });
  assert.equal(p.binaryName, "markspec.exe");
  assert.equal(p.target, path.join(HOME, ".local", "bin", "markspec.exe"));
  assert.equal(p.chmod, false);
});

test("isDirOnPath: true when present, false when absent", () => {
  const dir = "/home/dev/.local/bin";
  const env = ["/usr/bin", dir, "/bin"].join(path.delimiter);
  assert.equal(isDirOnPath(dir, env, path.delimiter, "linux"), true);
  assert.equal(
    isDirOnPath(dir, "/usr/bin:/bin", path.delimiter, "linux"),
    false,
  );
  assert.equal(isDirOnPath(dir, undefined, path.delimiter, "linux"), false);
});

test("isDirOnPath: win32 case-insensitive", () => {
  const dir = "C:\\Users\\Dev\\.local\\bin";
  const env = "C:\\Windows;c:\\users\\dev\\.local\\bin";
  assert.equal(isDirOnPath(dir, env, ";", "win32"), true);
});

test("pathHint: unix export, win32 setx", () => {
  assert.equal(
    pathHint("/home/dev/.local/bin", "linux"),
    'export PATH="/home/dev/.local/bin:$PATH"',
  );
  assert.equal(
    pathHint("C:\\Users\\Dev\\.local\\bin", "win32"),
    'setx PATH "C:\\Users\\Dev\\.local\\bin;%PATH%"',
  );
});

test("performCopy: copies file into a fresh dir and chmods on unix", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "msinstall-"));
  const src = path.join(tmp, "src-markspec");
  await fs.writeFile(src, "#!/bin/sh\necho hi\n");
  const plan: InstallPlan = {
    binaryName: "markspec",
    source: src,
    targetDir: path.join(tmp, "out", "bin"),
    target: path.join(tmp, "out", "bin", "markspec"),
    chmod: process.platform !== "win32",
  };
  await performCopy(plan);
  const copied = await fs.readFile(plan.target, "utf8");
  assert.equal(copied, "#!/bin/sh\necho hi\n");
  if (plan.chmod) {
    const st = await fs.stat(plan.target);
    assert.equal((st.mode & 0o111) !== 0, true);
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

test("performCopy: overwrites an existing target file", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "msinstall-ow-"));
  const src = path.join(tmp, "src-new");
  await fs.writeFile(src, "new-content\n");
  const targetDir = path.join(tmp, "out", "bin");
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, "markspec");
  await fs.writeFile(target, "stale-content\n");
  const plan: InstallPlan = {
    binaryName: "markspec",
    source: src,
    targetDir,
    target,
    chmod: process.platform !== "win32",
  };
  await performCopy(plan);
  assert.equal(await fs.readFile(target, "utf8"), "new-content\n");
  await fs.rm(tmp, { recursive: true, force: true });
});
