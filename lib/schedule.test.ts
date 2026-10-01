import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignSchedule,
  generateRoundRobinSchedule,
  generateScheduledRoundRobinSchedule,
  zonedDateTimeToUtc,
  type ScheduleSettings,
} from "./schedule";

test("circle method creates every pairing exactly once for 2 through 20 teams", () => {
  for (let teamCount = 2; teamCount <= 20; teamCount += 1) {
    const teams = Array.from(
      { length: teamCount },
      (_, index) => `Team ${index + 1}`,
    );
    const matchups = generateRoundRobinSchedule(teams, 1);
    const expectedRoundCount = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
    const expectedGamesPerRound = Math.floor(teamCount / 2);

    assert.equal(
      matchups.length,
      (teamCount * (teamCount - 1)) / 2,
      `${teamCount} teams should produce the right number of games`,
    );

    const pairings = new Set<string>();
    const gamesByTeam = new Map(teams.map((team) => [team, 0]));

    for (let round = 1; round <= expectedRoundCount; round += 1) {
      const roundMatchups = matchups.filter((matchup) => matchup.round === round);
      const teamsInRound = new Set<string>();

      assert.equal(roundMatchups.length, expectedGamesPerRound);

      for (const matchup of roundMatchups) {
        assert.notEqual(matchup.home, matchup.away);
        assert.equal(teamsInRound.has(matchup.home), false);
        assert.equal(teamsInRound.has(matchup.away), false);
        teamsInRound.add(matchup.home);
        teamsInRound.add(matchup.away);

        const pairing = [matchup.home, matchup.away].sort().join("::");
        assert.equal(pairings.has(pairing), false, `${pairing} should occur once`);
        pairings.add(pairing);
        gamesByTeam.set(matchup.home, gamesByTeam.get(matchup.home)! + 1);
        gamesByTeam.set(matchup.away, gamesByTeam.get(matchup.away)! + 1);
      }
    }

    assert.equal(pairings.size, (teamCount * (teamCount - 1)) / 2);
    assert.deepEqual([...gamesByTeam.values()], Array(teamCount).fill(teamCount - 1));
  }
});

test("additional round-robin cycles reverse home and away", () => {
  const firstCycle = generateRoundRobinSchedule(["A", "B", "C", "D"], 1);
  const twoCycles = generateRoundRobinSchedule(["A", "B", "C", "D"], 2);
  const secondCycle = twoCycles.slice(firstCycle.length);

  assert.deepEqual(
    secondCycle.map(({ home, away }) => `${home}:${away}`),
    firstCycle.map(({ home, away }) => `${away}:${home}`),
  );
  assert.deepEqual(secondCycle.map(({ round }) => round), [4, 4, 5, 5, 6, 6]);
});

test("a round spills across capacity and the next round starts on a later play date", () => {
  const scheduled = generateScheduledRoundRobinSchedule(
    Array.from({ length: 8 }, (_, index) => `Team ${index + 1}`),
    1,
    {
      startDate: "2026-09-14",
      gameDays: [1, 3],
      gameTimes: ["18:00"],
      fieldNames: ["North", "South"],
      timeZone: "America/Los_Angeles",
    },
  );

  assert.deepEqual(
    scheduled
      .slice(0, 8)
      .map(({ round, scheduledAt, fieldName }) => ({
        round,
        scheduledAt: scheduledAt.toISOString(),
        fieldName,
      }))
      .sort((left, right) =>
        left.round - right.round ||
        left.scheduledAt.localeCompare(right.scheduledAt) ||
        (left.fieldName ?? "").localeCompare(right.fieldName ?? ""),
      ),
    [
      { round: 1, scheduledAt: "2026-09-15T01:00:00.000Z", fieldName: "North" },
      { round: 1, scheduledAt: "2026-09-15T01:00:00.000Z", fieldName: "South" },
      { round: 1, scheduledAt: "2026-09-17T01:00:00.000Z", fieldName: "North" },
      { round: 1, scheduledAt: "2026-09-17T01:00:00.000Z", fieldName: "South" },
      { round: 2, scheduledAt: "2026-09-22T01:00:00.000Z", fieldName: "North" },
      { round: 2, scheduledAt: "2026-09-22T01:00:00.000Z", fieldName: "South" },
      { round: 2, scheduledAt: "2026-09-24T01:00:00.000Z", fieldName: "North" },
      { round: 2, scheduledAt: "2026-09-24T01:00:00.000Z", fieldName: "South" },
    ],
  );
});

test("rotating slot order balances the fixed team's times and fields", () => {
  const scheduled = generateScheduledRoundRobinSchedule(
    ["A", "B", "C", "D", "E", "F", "G", "H"],
    1,
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameTimes: ["18:00", "20:00"],
      fieldNames: ["North", "South"],
      timeZone: "UTC",
    },
  );
  const slotsForFixedTeam = scheduled
    .filter(({ home, away }) => home === "A" || away === "A")
    .map(({ scheduledAt, fieldName }) =>
      `${String(scheduledAt.getUTCHours()).padStart(2, "0")}:00 ${fieldName}`,
    );
  const counts = ["18:00 North", "18:00 South", "20:00 North", "20:00 South"]
    .map((slot) => slotsForFixedTeam.filter((value) => value === slot).length);

  assert.equal(slotsForFixedTeam.length, 7);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("ten-team schedules balance every team's times and fields despite round spillover", () => {
  const teams = Array.from({ length: 10 }, (_, index) => `Team ${index + 1}`);
  const scheduled = generateScheduledRoundRobinSchedule(teams, 1, {
    startDate: "2026-09-15",
    gameDays: [2],
    gameTimes: ["18:00", "20:00"],
    fieldNames: ["North", "South"],
    timeZone: "UTC",
  });

  assert.equal(scheduled.length, 45);

  for (const team of teams) {
    const teamGames = scheduled.filter(
      ({ home, away }) => home === team || away === team,
    );
    const timeCounts = [18, 20]
      .map((hour) =>
        teamGames.filter(({ scheduledAt }) => scheduledAt.getUTCHours() === hour)
          .length,
      )
      .sort((left, right) => left - right);
    const fieldCounts = ["North", "South"]
      .map((field) =>
        teamGames.filter(({ fieldName }) => fieldName === field).length,
      )
      .sort((left, right) => left - right);

    assert.equal(teamGames.length, 9);
    assert.deepEqual(timeCounts, [4, 5], `${team} should split early and late games`);
    assert.deepEqual(fieldCounts, [4, 5], `${team} should split fields`);
  }

  for (let round = 1; round <= 9; round += 1) {
    const gamesByDate = new Map<string, number>();

    for (const game of scheduled.filter((candidate) => candidate.round === round)) {
      const date = game.scheduledAt.toISOString().slice(0, 10);
      gamesByDate.set(date, (gamesByDate.get(date) ?? 0) + 1);
    }

    assert.deepEqual(
      [...gamesByDate.values()].sort((left, right) => left - right),
      [1, 4],
      `round ${round} should use all four first-date slots before spilling`,
    );
  }

  const physicalSlots = scheduled.map(
    ({ scheduledAt, fieldName }) => `${scheduledAt.toISOString()}::${fieldName}`,
  );
  assert.equal(new Set(physicalSlots).size, physicalSlots.length);
});

test("occupied games protect field and team slots while assigning only TBD games", () => {
  const scheduled = assignSchedule(
    [
      { round: 1, home: "A", away: "B" },
      { round: 1, home: "C", away: "D" },
    ],
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameTimes: ["18:00", "19:00"],
      fieldNames: ["North", "South"],
      timeZone: "UTC",
    },
    {
      occupiedGames: [
        {
          round: 2,
          home: "X",
          away: "Y",
          scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
          fieldName: "NORTH",
        },
        {
          round: 2,
          home: "A",
          away: "Z",
          scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
          fieldName: "External",
        },
      ],
    },
  );

  assert.equal(scheduled.length, 2);
  assert.deepEqual(
    scheduled.map(({ scheduledAt, fieldName }) => [
      scheduledAt.toISOString(),
      fieldName,
    ]),
    [
      ["2026-09-15T19:00:00.000Z", "North"],
      ["2026-09-15T18:00:00.000Z", "South"],
    ],
  );
});

test("occupied field collisions are case-insensitive", () => {
  assert.throws(
    () =>
      assignSchedule(
        [],
        {
          startDate: "2026-09-15",
          gameDays: [2],
          gameTimes: ["18:00"],
          fieldNames: ["North"],
          timeZone: "UTC",
        },
        {
          occupiedGames: [
            {
              round: 1,
              home: "A",
              away: "B",
              scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
              fieldName: "North",
            },
            {
              round: 1,
              home: "C",
              away: "D",
              scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
              fieldName: "north",
            },
          ],
        },
      ),
    /conflicts with another occupied field or team slot/,
  );
});

test("occupied game durations block partial overlaps", () => {
  const scheduled = assignSchedule(
    [{ round: 1, home: "A", away: "B" }],
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameDurationMinutes: 60,
      gameTimes: ["19:00", "20:00"],
      fieldNames: ["North"],
      timeZone: "UTC",
    },
    {
      occupiedGames: [
        {
          away: "Y",
          durationMinutes: 75,
          fieldName: "North",
          home: "X",
          round: 2,
          scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
        },
      ],
    },
  );

  assert.equal(scheduled[0].scheduledAt.toISOString(), "2026-09-15T20:00:00.000Z");
});

test("staggered starts use a newly-free field without double-booking", () => {
  const scheduled = assignSchedule(
    [
      { round: 1, home: "A", away: "B" },
      { round: 1, home: "C", away: "D" },
    ],
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameDurationMinutes: 60,
      gameTimes: ["09:00", "09:30"],
      fieldNames: ["North", "South"],
      timeZone: "UTC",
    },
    {
      occupiedGames: [
        {
          away: "Y",
          durationMinutes: 60,
          fieldName: "North",
          home: "X",
          round: 2,
          scheduledAt: new Date("2026-09-15T08:30:00.000Z"),
        },
      ],
    },
  );

  assert.deepEqual(
    scheduled.map((game) => [game.scheduledAt.toISOString(), game.fieldName]),
    [
      ["2026-09-15T09:00:00.000Z", "South"],
      ["2026-09-15T09:30:00.000Z", "North"],
    ],
  );
});

test("an occupied round advances later TBD rounds without being returned", () => {
  const scheduled = assignSchedule(
    [{ round: 2, home: "C", away: "D" }],
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameTimes: ["18:00"],
      fieldNames: ["North"],
      timeZone: "UTC",
    },
    {
      occupiedGames: [
        {
          round: 1,
          home: "A",
          away: "B",
          scheduledAt: new Date("2026-09-15T18:00:00.000Z"),
          fieldName: "North",
        },
      ],
    },
  );

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].scheduledAt.toISOString(), "2026-09-22T18:00:00.000Z");
});

test("times are chronological, fields are stable, and input settings are not mutated", () => {
  const settings: ScheduleSettings = {
    startDate: "2026-09-15",
    gameDays: [2],
    gameTimes: ["20:00", "18:00"],
    fieldNames: ["Field B", "Field A"],
    timeZone: "UTC",
  };
  const originalSettings = structuredClone(settings);
  const matchups = generateRoundRobinSchedule(
    ["A", "B", "C", "D", "E", "F", "G", "H"],
    1,
  );
  const firstRun = assignSchedule(matchups, settings);
  const secondRun = assignSchedule(matchups, settings);

  assert.deepEqual(settings, originalSettings);
  assert.deepEqual(
    firstRun.slice(0, 4).map(({ scheduledAt, fieldName }) => [
      scheduledAt.toISOString(),
      fieldName,
    ]),
    [
      ["2026-09-15T18:00:00.000Z", "Field B"],
      ["2026-09-15T18:00:00.000Z", "Field A"],
      ["2026-09-15T20:00:00.000Z", "Field B"],
      ["2026-09-15T20:00:00.000Z", "Field A"],
    ],
  );
  assert.deepEqual(
    secondRun.map(({ scheduledAt, fieldName }) => [scheduledAt.toISOString(), fieldName]),
    firstRun.map(({ scheduledAt, fieldName }) => [scheduledAt.toISOString(), fieldName]),
  );
});

test("an empty field list creates one unnamed slot per game time", () => {
  const scheduled = generateScheduledRoundRobinSchedule(
    ["A", "B", "C", "D"],
    1,
    {
      startDate: "2026-09-15",
      gameDays: [2],
      gameTimes: ["18:00", "19:00"],
      fieldNames: [],
      timeZone: "UTC",
    },
  );

  assert.deepEqual(
    scheduled.slice(0, 2).map(({ scheduledAt, fieldName }) => [
      scheduledAt.toISOString(),
      fieldName,
    ]),
    [
      ["2026-09-15T18:00:00.000Z", null],
      ["2026-09-15T19:00:00.000Z", null],
    ],
  );
});

test("the first round advances from startDate to the next allowed weekday", () => {
  const scheduled = generateScheduledRoundRobinSchedule(["A", "B"], 1, {
    startDate: "2026-09-15",
    gameDays: [4],
    gameTimes: ["18:00"],
    fieldNames: [],
    timeZone: "UTC",
  });

  assert.equal(scheduled[0].scheduledAt.toISOString(), "2026-09-17T18:00:00.000Z");
});

test("UTC instants follow the league time zone across daylight saving time", () => {
  const scheduled = generateScheduledRoundRobinSchedule(["A", "B"], 2, {
    startDate: "2026-03-01",
    gameDays: [0],
    gameTimes: ["10:00"],
    fieldNames: [],
    timeZone: "America/Los_Angeles",
  });

  assert.deepEqual(
    scheduled.map(({ scheduledAt }) => scheduledAt.toISOString()),
    ["2026-03-01T18:00:00.000Z", "2026-03-08T17:00:00.000Z"],
  );
});

test("DST gaps are rejected and repeated local times choose the earlier instant", () => {
  assert.throws(
    () =>
      zonedDateTimeToUtc(
        "2026-03-08",
        "02:30",
        "America/Los_Angeles",
      ),
    /scheduled local time 2026-03-08 02:30 does not exist/,
  );

  assert.equal(
    zonedDateTimeToUtc(
      "2026-11-01",
      "01:30",
      "America/Los_Angeles",
    ).toISOString(),
    "2026-11-01T08:30:00.000Z",
  );
});

test("non-hour IANA offsets are converted without relying on the process time zone", () => {
  assert.equal(
    zonedDateTimeToUtc("2026-09-15", "18:15", "Asia/Kathmandu").toISOString(),
    "2026-09-15T12:30:00.000Z",
  );
});

test("invalid scheduling settings fail with specific validation errors", () => {
  const matchup = [{ round: 1, home: "A", away: "B" }];
  const valid: ScheduleSettings = {
    startDate: "2026-09-15",
    gameDays: [2],
    gameTimes: ["18:00"],
    fieldNames: ["Main"],
    timeZone: "UTC",
  };
  const cases: Array<[ScheduleSettings, RegExp]> = [
    [{ ...valid, startDate: "09/15/2026" }, /startDate.*YYYY-MM-DD/],
    [{ ...valid, startDate: "2026-02-30" }, /startDate.*YYYY-MM-DD/],
    [{ ...valid, gameDays: [] }, /gameDays.*at least one/],
    [{ ...valid, gameDays: [7] }, /gameDays.*0 through 6/],
    [{ ...valid, gameDays: [2, 2] }, /gameDays.*duplicate/],
    [{ ...valid, gameTimes: [] }, /gameTimes.*at least one/],
    [{ ...valid, gameTimes: ["6:00"] }, /gameTimes.*HH:mm/],
    [{ ...valid, gameTimes: ["24:00"] }, /gameTimes.*HH:mm/],
    [{ ...valid, gameTimes: ["18:00", "18:00"] }, /gameTimes.*duplicate/],
    [{ ...valid, fieldNames: ["   "] }, /fieldNames.*non-empty/],
    [{ ...valid, fieldNames: ["Main", " Main "] }, /fieldNames.*duplicate/],
    [{ ...valid, fieldNames: ["North", "north"] }, /fieldNames.*duplicate/],
    [{ ...valid, timeZone: "Mars/Olympus" }, /timeZone.*IANA/],
  ];

  for (const [settings, expectedError] of cases) {
    assert.throws(() => assignSchedule(matchup, settings), expectedError);
  }
});

test("invalid matchups are rejected instead of producing partial schedules", () => {
  const settings: ScheduleSettings = {
    startDate: "2026-09-15",
    gameDays: [2],
    gameTimes: ["18:00"],
    fieldNames: [],
    timeZone: "UTC",
  };

  assert.throws(
    () => assignSchedule([{ round: 0, home: "A", away: "B" }], settings),
    /matchups\[0\]\.round.*positive integer/,
  );
  assert.throws(
    () => assignSchedule([{ round: 1, home: "A", away: "A" }], settings),
    /two different teams/,
  );
  assert.throws(
    () =>
      assignSchedule(
        [
          { round: 1, home: "A", away: "B" },
          { round: 1, home: " A ", away: "C" },
        ],
        settings,
      ),
    /schedules A more than once in round 1/,
  );
});

test("the internal bye marker can also be used as a real team name", () => {
  const matchups = generateRoundRobinSchedule(["__BYE__", "B", "C"], 1);

  assert.equal(matchups.length, 3);
  assert.deepEqual(
    new Set(
      matchups.map(({ home, away }) => [home, away].sort().join("::")),
    ),
    new Set(["B::__BYE__", "C::__BYE__", "B::C"]),
  );
});
