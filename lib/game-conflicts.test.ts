import assert from "node:assert/strict";
import test from "node:test";

import { findGameConflict, intervalsOverlap } from "./game-conflicts";

test("adjacent games do not overlap but one-minute overlap does", () => {
  const start = new Date("2026-09-15T18:00:00Z");
  assert.equal(
    intervalsOverlap(start, 60, new Date("2026-09-15T19:00:00Z"), 60),
    false,
  );
  assert.equal(
    intervalsOverlap(start, 60, new Date("2026-09-15T18:59:00Z"), 60),
    true,
  );
});

test("field conflicts are case-insensitive and rainouts release their slot", () => {
  const proposed = {
    awayTeamId: "away",
    fieldName: " North Field ",
    homeTeamId: "home",
    scheduledAt: new Date("2026-09-15T18:30:00Z"),
  };
  const occupied = {
    awayTeamId: "other-away",
    fieldName: "north field",
    homeTeamId: "other-home",
    id: "game",
    scheduledAt: new Date("2026-09-15T18:00:00Z"),
    status: "SCHEDULED" as const,
  };

  assert.equal(findGameConflict(proposed, [occupied], 60)?.id, "game");
  assert.equal(
    findGameConflict(proposed, [{ ...occupied, status: "RAINED_OUT" }], 60),
    null,
  );
});
