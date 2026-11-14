import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PROJECT_MARKER_GLOB, shouldStartServer } from "./projectGate";

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
