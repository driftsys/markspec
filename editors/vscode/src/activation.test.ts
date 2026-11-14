import { test } from "node:test";
import { strict as assert } from "node:assert";
import { activateWith, SERVERLESS_COMMANDS } from "./activation";
import type { GateHost } from "./projectGate";

function fakeActivation(markers: number) {
  const registered: string[] = [];
  const subscriptions: unknown[] = [];
  const watcher = { onDidCreate: () => {}, dispose: () => {} };
  let starts = 0;
  const gate: GateHost = {
    findFiles: () => Promise.resolve(new Array(markers).fill({})),
    createWatcher: () => watcher,
    start: () => {
      starts++;
    },
  };
  const host = {
    subscriptions,
    registerCommand: (id: string) => {
      registered.push(id);
      return { dispose: () => {} };
    },
    commandHandlers: {
      "markspec.showOutput": () => {},
      "markspec.installToPath": () => {},
    },
    gate,
  };
  return { host, registered, subscriptions, watcher, starts: () => starts };
}

test("serverless commands are the two command ids", () => {
  assert.deepEqual([...SERVERLESS_COMMANDS], [
    "markspec.showOutput",
    "markspec.installToPath",
  ]);
});

test("without a marker, both commands register, no server starts, the watcher is kept", async () => {
  const f = fakeActivation(0);
  await activateWith(f.host);
  assert.deepEqual(f.registered, [
    "markspec.showOutput",
    "markspec.installToPath",
  ]);
  assert.equal(f.starts(), 0);
  assert.ok(f.subscriptions.includes(f.watcher), "watcher in subscriptions");
  assert.equal(f.subscriptions.length, 3);
});

test("with a marker, both commands register and the server starts", async () => {
  const f = fakeActivation(1);
  await activateWith(f.host);
  assert.deepEqual(f.registered, [
    "markspec.showOutput",
    "markspec.installToPath",
  ]);
  assert.equal(f.starts(), 1);
  assert.equal(f.subscriptions.length, 2);
});
