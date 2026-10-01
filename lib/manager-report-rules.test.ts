import assert from "node:assert/strict";
import test from "node:test";

import { managerReportRuleViolation } from "./manager-report-rules";

const GAME = {
  awayTeamId: "team_blue",
  hasResult: false,
  homeTeamId: "team_red",
  id: "game_target",
};

test("a final game accepts only a corrected score report", () => {
  const violation = managerReportRuleViolation({
    game: { ...GAME, hasResult: true },
    gameDurationMinutes: 60,
    games: [],
    leagueTimeZone: "America/Los_Angeles",
    proposedSlot: null,
    reportType: "RAINOUT",
  });

  assert.match(violation ?? "", /final game/i);
  assert.equal(
    managerReportRuleViolation({
      game: { ...GAME, hasResult: true },
      gameDurationMinutes: 60,
      games: [],
      leagueTimeZone: "America/Los_Angeles",
      proposedSlot: null,
      reportType: "SCORE",
    }),
    null,
  );
});

test("reschedule reports reject stale time zones and overlapping slots", () => {
  const base = {
    game: GAME,
    gameDurationMinutes: 60,
    leagueTimeZone: "America/Los_Angeles",
    reportType: "RESCHEDULE" as const,
  };
  assert.match(
    managerReportRuleViolation({
      ...base,
      games: [],
      proposedSlot: {
        fieldName: "North",
        scheduledAt: new Date("2026-10-04T16:00:00.000Z"),
        timeZone: "UTC",
      },
    }) ?? "",
    /time zone changed/i,
  );

  assert.match(
    managerReportRuleViolation({
      ...base,
      games: [
        {
          awayTeamId: "team_green",
          fieldName: "South",
          homeTeamId: "team_red",
          id: "game_conflict",
          scheduledAt: new Date("2026-10-04T16:30:00.000Z"),
          status: "SCHEDULED",
        },
      ],
      proposedSlot: {
        fieldName: "North",
        scheduledAt: new Date("2026-10-04T16:00:00.000Z"),
        timeZone: "America/Los_Angeles",
      },
    }) ?? "",
    /overlaps game game_conflict/i,
  );
});
