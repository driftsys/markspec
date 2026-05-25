import { assertEquals } from "@std/assert";
import { aggregateStatusByState, type BoundEntryStatus } from "./status.ts";

const ENTRIES: BoundEntryStatus[] = [
  {
    displayId: "REQ-001",
    system: "jira",
    externalId: "jira:1",
    remoteState: "ok",
  },
  {
    displayId: "REQ-002",
    system: "jira",
    externalId: "jira:2",
    remoteState: "conflict",
  },
  {
    displayId: "REQ-003",
    system: "jira",
    externalId: "jira:3",
    remoteState: "ok",
  },
  {
    displayId: "REQ-004",
    system: "doors",
    externalId: "doors:1",
    remoteState: "behind",
  },
];

Deno.test("aggregateStatusByState: groups by remote_state", () => {
  const g = aggregateStatusByState(ENTRIES);
  assertEquals(g.get("ok")?.length, 2);
  assertEquals(g.get("conflict")?.length, 1);
  assertEquals(g.get("behind")?.length, 1);
});

Deno.test("aggregateStatusByState: entries sorted by displayId within each group", () => {
  const g = aggregateStatusByState(ENTRIES);
  const okGroup = g.get("ok")!;
  assertEquals(okGroup[0].displayId, "REQ-001");
  assertEquals(okGroup[1].displayId, "REQ-003");
});
