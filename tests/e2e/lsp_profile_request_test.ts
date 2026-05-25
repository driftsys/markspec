/**
 * @module tests/e2e/lsp_profile_request_test
 *
 * E2E tests for the `markspec/profile` custom request and
 * `markspec/profileChanged` notification.
 *
 * Covers design doc §7.2:
 *   - populated response when a profile is loaded;
 *   - empty shape when no profile is configured;
 *   - notification fires after a `workspace/didChangeWatchedFiles` event.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

interface ProfileLayer {
  name: string;
  source: string;
}
interface ProfileType {
  name: string;
  prefix: string;
  color: string | null;
}
interface MarkspecProfileResponse {
  chain: ProfileLayer[];
  effective: { name: string; types: ProfileType[] };
}

Deno.test("lsp markspec/profile: returns populated response with loaded profile", async () => {
  // Minimal project.yaml + .markspec.yaml that activates the bundled default
  // profile. The default profile declares the 16 core type names — the
  // exact membership is verified by core/profile tests, not here. We
  // only assert structural shape.
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ".markspec.yaml": "profiles: []\n",
  });
  try {
    await client.initialize();

    const result = await client.request(
      "markspec/profile",
      {},
    ) as MarkspecProfileResponse;

    assertExists(result);
    assertExists(result.chain);
    assertExists(result.effective);
    // Default profile yields a non-empty chain.
    assert(
      result.chain.length >= 1,
      `Expected non-empty chain, got: ${JSON.stringify(result.chain)}`,
    );
    // Effective name should not be "(none)" when a profile is loaded.
    assert(
      result.effective.name !== "(none)",
      `Expected loaded profile, got "(none)"`,
    );
    // Types array is present (may be non-empty with default profile).
    assertExists(result.effective.types);
    // Every type carries the expected shape.
    for (const t of result.effective.types) {
      assertEquals(typeof t.name, "string");
      assertEquals(typeof t.prefix, "string");
      assert(
        t.color === null || typeof t.color === "string",
        `color must be string|null, got ${typeof t.color}`,
      );
    }
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp markspec/profile: returns empty shape when no profile is configured", async () => {
  // `.markspec.yaml` with `default-profile: false` is the documented
  // opt-out per `core/profile/load.ts:35-38`.
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ".markspec.yaml": "default-profile: false\nprofiles: []\n",
  });
  try {
    await client.initialize();

    const result = await client.request(
      "markspec/profile",
      {},
    ) as MarkspecProfileResponse;

    assertEquals(result.chain, []);
    assertEquals(result.effective.name, "(none)");
    assertEquals(result.effective.types, []);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp markspec/profile: notification fires after watched-file change", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ".markspec.yaml": "profiles: []\n",
  });
  try {
    await client.initialize();

    // Sanity: initial response is populated.
    const before = await client.request(
      "markspec/profile",
      {},
    ) as MarkspecProfileResponse;
    assert(before.chain.length >= 1);

    // Simulate the client sending a watched-file change. The server
    // debounces 500ms; we wait up to 3000ms for the notification
    // (generous to absorb slow-disk CI environments).
    const filePath = join(client.workDir, ".markspec.yaml");
    await client.notify("workspace/didChangeWatchedFiles", {
      changes: [
        { uri: toFileUrl(filePath).href, type: 2 /* Changed */ },
      ],
    });

    const notif = await client.waitForNotification(
      "markspec/profileChanged",
      3000,
    );
    assertExists(notif.params);
    const payload = notif.params as MarkspecProfileResponse;
    assertExists(payload.chain);
    assertExists(payload.effective);
  } finally {
    await client.shutdown();
  }
});
