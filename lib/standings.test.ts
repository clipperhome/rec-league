import assert from "node:assert/strict";
import test from "node:test";

import { buildStandings } from "./standings";

const teams = [
  { id: "a", name: "Atlas" },
  { id: "b", name: "Bears" },
  { id: "c", name: "Comets" },
];

test("awards three points for a win and one for a tie", () => {
  const table = buildStandings(teams, [
    completedGame("a", "b", 3, 1),
    completedGame("b", "c", 2, 2),
  ]);

  assert.deepEqual(
    table.map(({ teamName, played, wins, losses, ties, points }) => ({
      teamName,
      played,
      wins,
      losses,
      ties,
      points,
    })),
    [
      { teamName: "Atlas", played: 1, wins: 1, losses: 0, ties: 0, points: 3 },
      { teamName: "Comets", played: 1, wins: 0, losses: 0, ties: 1, points: 1 },
      { teamName: "Bears", played: 2, wins: 0, losses: 1, ties: 1, points: 1 },
    ],
  );
});

test("ignores unfinished and rained-out games even if stale result data exists", () => {
  const table = buildStandings(teams, [
    {
      awayTeamId: "b",
      homeTeamId: "a",
      result: { awayScore: 0, homeScore: 8 },
      status: "RAINED_OUT",
    },
    {
      awayTeamId: "c",
      homeTeamId: "a",
      result: null,
      status: "SCHEDULED",
    },
  ]);

  assert.ok(table.every((row) => row.played === 0 && row.points === 0));
});

test("breaks equal points by differential, scores for, then team name", () => {
  const table = buildStandings(teams, [
    completedGame("a", "b", 2, 0),
    completedGame("c", "a", 3, 1),
    completedGame("b", "c", 4, 2),
  ]);

  assert.deepEqual(table.map((row) => row.teamName), ["Comets", "Bears", "Atlas"]);
});

test("uses league-specific win, tie, and loss points", () => {
  const table = buildStandings(
    teams,
    [completedGame("a", "b", 3, 1), completedGame("b", "c", 2, 2)],
    { lossPoints: 1, tiePoints: 2, winPoints: 5 },
  );

  assert.deepEqual(
    Object.fromEntries(table.map((row) => [row.teamName, row.points])),
    { Atlas: 5, Bears: 3, Comets: 2 },
  );
});

function completedGame(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
) {
  return {
    awayTeamId,
    homeTeamId,
    result: { awayScore, homeScore },
    status: "COMPLETED" as const,
  };
}
