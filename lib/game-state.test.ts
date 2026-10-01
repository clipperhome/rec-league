import assert from "node:assert/strict";
import test from "node:test";

import { classifyGameState } from "./game-state";

const kickoff = new Date("2026-09-15T18:00:00.000Z");
const game = {
  result: null,
  scheduledAt: kickoff,
  status: "SCHEDULED" as const,
};

test("classifies the exact kickoff and end boundaries", () => {
  assert.equal(
    classifyGameState(game, 60, new Date(kickoff.getTime() - 1)),
    "scheduled",
  );
  assert.equal(classifyGameState(game, 60, kickoff), "in-progress");
  assert.equal(
    classifyGameState(game, 60, new Date(kickoff.getTime() + 3_600_000 - 1)),
    "in-progress",
  );
  assert.equal(
    classifyGameState(game, 60, new Date(kickoff.getTime() + 3_600_000)),
    "result-pending",
  );
});

test("rainout outranks stale result data", () => {
  assert.equal(
    classifyGameState(
      { ...game, result: { homeScore: 2 }, status: "RAINED_OUT" },
      60,
      kickoff,
    ),
    "rained-out",
  );
});

test("completed without a result stays pending instead of showing a false final", () => {
  assert.equal(
    classifyGameState({ ...game, status: "COMPLETED" }, 60, kickoff),
    "result-pending",
  );
  assert.equal(
    classifyGameState(
      { ...game, status: "COMPLETED" },
      60,
      new Date(kickoff.getTime() - 60_000),
    ),
    "result-pending",
  );
});

test("an undated reschedule is TBD", () => {
  assert.equal(
    classifyGameState(
      { ...game, scheduledAt: null, status: "RESCHEDULED" },
      60,
      kickoff,
    ),
    "tbd",
  );
});
