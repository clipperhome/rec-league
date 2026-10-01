import assert from "node:assert/strict";
import test from "node:test";

import type { ScheduleSettings } from "./schedule";
import {
  buildRebuildSchedulePlan,
  schedulePreviewFingerprint,
  type RebuildSourceGame,
} from "./schedule-rebuild";

const settings: ScheduleSettings = {
  fieldNames: ["North"],
  gameDays: [6],
  gameDurationMinutes: 60,
  gameTimes: ["09:00", "10:00"],
  startDate: "2026-09-19",
  timeZone: "UTC",
};

test("rebuild planning preserves a final's displayed wall clock across time zones", () => {
  const games: RebuildSourceGame[] = [
    {
      away: "B",
      fieldName: "North",
      hasResult: true,
      home: "A",
      id: "final",
      locked: true,
      round: 1,
      scheduledAt: new Date("2026-09-19T16:00:00.000Z"),
      status: "COMPLETED",
      version: 3,
    },
    {
      away: "D",
      fieldName: null,
      hasResult: false,
      home: "C",
      id: "unplayed",
      locked: false,
      round: 2,
      scheduledAt: null,
      status: "SCHEDULED",
      version: 0,
    },
  ];

  const plan = buildRebuildSchedulePlan(
    games,
    "America/Los_Angeles",
    settings,
  );

  assert.equal(plan.preserved.length, 1);
  assert.equal(plan.preserved[0].id, "final");
  assert.equal(plan.preserved[0].scheduledAt.toISOString(), "2026-09-19T09:00:00.000Z");
  assert.equal(plan.rebuilt.length, 1);
  assert.equal(plan.rebuilt[0].id, "unplayed");
  assert.equal(plan.rebuilt[0].moved, true);
});

test("preview fingerprints ignore game order but change with versions or settings", () => {
  const first = schedulePreviewFingerprint(
    [{ id: "b", version: 2 }, { id: "a", version: 1 }],
    settings,
  );
  const reordered = schedulePreviewFingerprint(
    [{ id: "a", version: 1 }, { id: "b", version: 2 }],
    settings,
  );
  const newerGame = schedulePreviewFingerprint(
    [{ id: "a", version: 1 }, { id: "b", version: 3 }],
    settings,
  );
  const newField = schedulePreviewFingerprint(
    [{ id: "a", version: 1 }, { id: "b", version: 2 }],
    { ...settings, fieldNames: ["South"] },
  );

  assert.equal(first, reordered);
  assert.notEqual(first, newerGame);
  assert.notEqual(first, newField);
});
