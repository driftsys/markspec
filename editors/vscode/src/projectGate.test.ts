import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  type GateHost,
  PROJECT_MARKER_GLOB,
  shouldStartServer,
  startServerWhenProject,
} from "./projectGate";

test("starts the server when a .markspec.yaml exists", async () => {
  const calls: Array<[string, number | undefined]> = [];
  const result = await shouldStartServer((glob, maxResults) => {
    calls.push([glob, maxResults]);
    return Promise.resolve([{}]);
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[PROJECT_MARKER_GLOB, 1]]);
});

test("does not start the server without a .markspec.yaml", async () => {
  assert.equal(await shouldStartServer(() => Promise.resolve([])), false);
});

test("marker glob matches .markspec.yaml at any depth", () => {
  assert.equal(PROJECT_MARKER_GLOB, "**/.markspec.yaml");
});

/** A fake host for `startServerWhenProject`; records every call. */
function fakeHost(markers: number) {
  const log = {
    starts: 0,
    globs: [] as string[],
    created: [] as Array<() => void>,
    changed: [] as Array<() => void>,
    disposed: 0,
  };
  const host: GateHost = {
    findFiles: () => Promise.resolve(new Array(markers).fill({})),
    createWatcher: (glob) => {
      log.globs.push(glob);
      return {
        onDidCreate: (cb) => {
          log.created.push(cb);
        },
        onDidChange: (cb) => {
          log.changed.push(cb);
        },
        dispose: () => {
          log.disposed++;
        },
      };
    },
    start: () => {
      log.starts++;
    },
  };
  return { host, log };
}

test("gate starts the server at once when a marker exists", async () => {
  const { host, log } = fakeHost(1);
  const watcher = await startServerWhenProject(host);
  assert.equal(log.starts, 1);
  assert.equal(watcher, undefined);
  assert.deepEqual(log.globs, []);
});

test("gate does not start the server without a marker", async () => {
  const { host, log } = fakeHost(0);
  const watcher = await startServerWhenProject(host);
  assert.equal(log.starts, 0);
  assert.ok(watcher);
  assert.deepEqual(log.globs, [PROJECT_MARKER_GLOB]);
});

test("gate starts once when a marker is created later, on onDidCreate", async () => {
  const { host, log } = fakeHost(0);
  await startServerWhenProject(host);
  assert.equal(log.changed.length, 0, "onDidChange is not used");
  assert.equal(log.created.length, 1);
  log.created[0]();
  assert.equal(log.starts, 1);
  assert.equal(log.disposed, 1, "the watcher is disposed after the start");
  log.created[0]();
  assert.equal(log.starts, 1, "a second create does not start again");
});
