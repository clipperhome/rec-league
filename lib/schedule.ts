export type RoundRobinMatchup = {
  round: number;
  home: string;
  away: string;
};

export type ScheduleSettings = {
  /** First local calendar date on which games may be scheduled. */
  startDate: string;
  /** Local weekdays, using JavaScript's Sunday (0) through Saturday (6). */
  gameDays: readonly number[];
  /** Local start times in 24-hour HH:mm format. */
  gameTimes: readonly string[];
  /** One simultaneous slot is created per field. An empty list means one unnamed slot. */
  fieldNames: readonly string[];
  /** IANA time zone used to turn each local game time into a UTC instant. */
  timeZone: string;
  /** Used to prevent overlapping games on the same field or for the same team. */
  gameDurationMinutes?: number;
};

export type ScheduledRoundRobinMatchup = RoundRobinMatchup & {
  scheduledAt: Date;
  fieldName: string | null;
};

export type OccupiedScheduleGame = ScheduledRoundRobinMatchup & {
  /** Defaults to the schedule's game duration when omitted. */
  durationMinutes?: number;
};

export type ScheduleAssignmentOptions = {
  /** Games that keep their current slot and must not be overwritten. */
  occupiedGames?: readonly OccupiedScheduleGame[];
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type GameTime = {
  value: string;
  hour: number;
  minute: number;
};

type NormalizedScheduleSettings = {
  startDate: CalendarDate;
  gameDays: ReadonlySet<number>;
  gameTimes: readonly GameTime[];
  fieldNames: readonly string[];
  gameDurationMinutes: number;
} & TimeZoneContext;

type TimeZoneContext = {
  timeZone: string;
  formatter: Intl.DateTimeFormat;
};

type ScheduleSlot = {
  time: GameTime;
  fieldName: string | null;
};

type CandidateScheduleSlot = ScheduleSlot & {
  scheduledAt: Date;
  sequence: number;
};

type IndexedMatchup = {
  matchup: RoundRobinMatchup;
  index: number;
};

type NormalizedOccupiedGame = RoundRobinMatchup & {
  scheduledAt: Date;
  fieldName: string | null;
  durationMinutes: number;
};

type RoundWork = {
  matchups: IndexedMatchup[];
  occupiedDates: CalendarDate[];
  teams: Set<string>;
};

type ScheduleOccupancyEntry = {
  startsAt: number;
  endsAt: number;
  fieldName: string;
  teams: Set<string>;
};

type ScheduleOccupancy = ScheduleOccupancyEntry[];

type TeamFairnessCounts = {
  fields: Map<string, number>;
  slots: Map<string, number>;
  times: Map<string, number>;
};

type ScheduleFairness = Map<string, TeamFairnessCounts>;

type RoundAssignment = {
  candidate: CandidateScheduleSlot;
  matchupPosition: number;
};

type RoundAssignmentState = {
  assignments: RoundAssignment[];
  fairnessCost: number;
};

const BYE_TEAM: unique symbol = Symbol("bye team");

export function generateRoundRobinSchedule(
  teamNames: string[],
  rounds: number,
): RoundRobinMatchup[] {
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error("rounds must be a positive integer");
  }

  const normalizedTeams = normalizeTeamNames(teamNames);

  if (normalizedTeams.length < 2) {
    return [];
  }

  const rotation: Array<string | typeof BYE_TEAM> = normalizedTeams.length % 2 === 0
    ? [...normalizedTeams]
    : [...normalizedTeams, BYE_TEAM];
  const roundsPerCycle = rotation.length - 1;
  const matchupsPerRound = rotation.length / 2;
  const schedule: RoundRobinMatchup[] = [];

  for (let cycle = 0; cycle < rounds; cycle += 1) {
    let currentOrder = [...rotation];

    for (let roundIndex = 0; roundIndex < roundsPerCycle; roundIndex += 1) {
      const roundNumber = cycle * roundsPerCycle + roundIndex + 1;

      for (let pairIndex = 0; pairIndex < matchupsPerRound; pairIndex += 1) {
        const firstTeam = currentOrder[pairIndex];
        const secondTeam = currentOrder[currentOrder.length - 1 - pairIndex];

        if (firstTeam === BYE_TEAM || secondTeam === BYE_TEAM) {
          continue;
        }

        const [home, away] = resolveHomeAway(
          firstTeam,
          secondTeam,
          roundIndex,
          pairIndex,
          cycle,
        );

        schedule.push({
          round: roundNumber,
          home,
          away,
        });
      }

      currentOrder = rotateTeams(currentOrder);
    }
  }

  return schedule;
}

/**
 * Assigns every matchup to a concrete UTC instant and, when configured, a field.
 *
 * The first round starts on `startDate` when that date is an allowed weekday, or
 * on the next allowed weekday otherwise. A round can spill onto later allowed
 * dates when it contains more games than one date's time-by-field capacity. The
 * following round always starts on an allowed date after the previous round's
 * final date, even when unused slots remain on that final date.
 * Existing games passed through `occupiedGames` retain their slots; the returned
 * array contains assignments only for `matchups`.
 *
 * If a local time is repeated when daylight saving time ends, the earlier UTC
 * instant is selected. A local time skipped by a clock change is rejected.
 */
export function assignSchedule(
  matchups: readonly RoundRobinMatchup[],
  settings: ScheduleSettings,
  options: ScheduleAssignmentOptions = {},
): ScheduledRoundRobinMatchup[] {
  const normalizedSettings = normalizeScheduleSettings(settings);
  const occupiedGames = normalizeOccupiedGames(
    options,
    normalizedSettings.gameDurationMinutes,
  );
  const indexedMatchups = matchups.map((matchup, index) => {
    validateMatchup(matchup, index);

    return { matchup, index };
  });

  const rounds = new Map<number, RoundWork>();

  for (const indexedMatchup of indexedMatchups) {
    const round = getOrCreateRound(rounds, indexedMatchup.matchup.round);
    reserveTeamsInRound(
      round,
      indexedMatchup.matchup,
      `matchups[${indexedMatchup.index}]`,
    );
    round.matchups.push(indexedMatchup);
  }

  for (const [index, occupiedGame] of occupiedGames.entries()) {
    const round = getOrCreateRound(rounds, occupiedGame.round);
    reserveTeamsInRound(round, occupiedGame, `occupiedGames[${index}]`);
    round.occupiedDates.push(
      getCalendarDateInTimeZone(
        occupiedGame.scheduledAt,
        normalizedSettings.formatter,
      ),
    );
  }

  const slots = buildScheduleSlots(normalizedSettings);
  const occupancy = buildScheduleOccupancy(occupiedGames);
  const fairness = buildScheduleFairness(
    occupiedGames,
    normalizedSettings.formatter,
  );
  const scheduled = new Array<ScheduledRoundRobinMatchup>(matchups.length);
  let earliestRoundDate = normalizedSettings.startDate;

  for (const roundNumber of [...rounds.keys()].sort((left, right) => left - right)) {
    const round = rounds.get(roundNumber);

    if (!round) {
      continue;
    }

    let playDate = findNextPlayDate(
      earliestRoundDate,
      normalizedSettings.gameDays,
    );
    const roundSlots = rotateItems(slots, (roundNumber - 1) % slots.length);

    if (round.matchups.length > 0) {
      const assignedRound = assignRoundMatchups(
        round.matchups,
        playDate,
        roundSlots,
        normalizedSettings,
        occupancy,
        fairness,
      );
      playDate = assignedRound.finalDate;

      for (const { candidate, matchupPosition } of assignedRound.assignments) {
        const { matchup, index } = round.matchups[matchupPosition];

        scheduled[index] = {
          ...matchup,
          scheduledAt: candidate.scheduledAt,
          fieldName: candidate.fieldName,
        };
        occupyScheduleSlot(
          matchup,
          candidate.scheduledAt,
          candidate.fieldName,
          occupancy,
          normalizedSettings.gameDurationMinutes,
        );
        recordFairnessAssignment(matchup, candidate, fairness);
      }
    }

    const finalRoundDate = round.occupiedDates.reduce(
      (latestDate, occupiedDate) =>
        compareCalendarDates(occupiedDate, latestDate) > 0
          ? occupiedDate
          : latestDate,
      playDate,
    );
    earliestRoundDate = addCalendarDays(finalRoundDate, 1);
  }

  return scheduled;
}

/** Generates matchups and assigns their dates in one deterministic operation. */
export function generateScheduledRoundRobinSchedule(
  teamNames: string[],
  rounds: number,
  settings: ScheduleSettings,
): ScheduledRoundRobinMatchup[] {
  return assignSchedule(generateRoundRobinSchedule(teamNames, rounds), settings);
}

/** Converts one local league date and time to its UTC instant. */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const parsedDate = parseStartDate(date);
  const [parsedTime] = normalizeGameTimes([time]);

  return localDateTimeToUtc(parsedDate, parsedTime, normalizeTimeZone(timeZone));
}

function normalizeTeamNames(teamNames: string[]): string[] {
  const normalizedTeams = teamNames.map((teamName) => teamName.trim());

  if (normalizedTeams.some((teamName) => teamName.length === 0)) {
    throw new Error("team names must be non-empty");
  }

  if (new Set(normalizedTeams).size !== normalizedTeams.length) {
    throw new Error("team names must be unique");
  }

  return normalizedTeams;
}

function normalizeScheduleSettings(
  settings: ScheduleSettings,
): NormalizedScheduleSettings {
  if (!settings || typeof settings !== "object") {
    throw new Error("schedule settings are required");
  }

  const startDate = parseStartDate(settings.startDate);
  const gameDays = normalizeGameDays(settings.gameDays);
  const gameTimes = normalizeGameTimes(settings.gameTimes);
  const fieldNames = normalizeFieldNames(settings.fieldNames);
  const gameDurationMinutes = normalizeGameDuration(
    settings.gameDurationMinutes ?? 60,
  );
  const { timeZone, formatter } = normalizeTimeZone(settings.timeZone);

  return {
    startDate,
    gameDays,
    gameTimes,
    fieldNames,
    gameDurationMinutes,
    timeZone,
    formatter,
  };
}

function normalizeOccupiedGames(
  options: ScheduleAssignmentOptions,
  defaultDurationMinutes: number,
): NormalizedOccupiedGame[] {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("schedule assignment options must be an object");
  }

  if (options.occupiedGames === undefined) {
    return [];
  }

  if (!Array.isArray(options.occupiedGames)) {
    throw new Error("occupiedGames must be an array");
  }

  return options.occupiedGames.map((game, index) => {
    validateMatchup(game, index, "occupiedGames");

    if (!(game.scheduledAt instanceof Date) || Number.isNaN(game.scheduledAt.getTime())) {
      throw new Error(`occupiedGames[${index}].scheduledAt must be a valid Date`);
    }

    if (
      game.fieldName !== null &&
      (typeof game.fieldName !== "string" || game.fieldName.trim().length === 0)
    ) {
      throw new Error(
        `occupiedGames[${index}].fieldName must be a non-empty name or null`,
      );
    }

    return {
      round: game.round,
      home: game.home,
      away: game.away,
      scheduledAt: new Date(game.scheduledAt.getTime()),
      fieldName: game.fieldName === null ? null : game.fieldName.trim(),
      durationMinutes:
        game.durationMinutes === undefined
          ? defaultDurationMinutes
          : normalizeGameDuration(game.durationMinutes),
    };
  });
}

function getOrCreateRound(
  rounds: Map<number, RoundWork>,
  roundNumber: number,
): RoundWork {
  const existingRound = rounds.get(roundNumber);

  if (existingRound) {
    return existingRound;
  }

  const round = {
    matchups: [],
    occupiedDates: [],
    teams: new Set<string>(),
  };
  rounds.set(roundNumber, round);

  return round;
}

function reserveTeamsInRound(
  round: RoundWork,
  matchup: RoundRobinMatchup,
  source: string,
): void {
  for (const team of [matchup.home.trim(), matchup.away.trim()]) {
    if (round.teams.has(team)) {
      throw new Error(`${source} schedules ${team} more than once in round ${matchup.round}`);
    }

    round.teams.add(team);
  }
}

function buildScheduleOccupancy(
  occupiedGames: readonly NormalizedOccupiedGame[],
): ScheduleOccupancy {
  const occupancy: ScheduleOccupancy = [];

  for (const [index, game] of occupiedGames.entries()) {
    if (
      !isSlotAvailable(
        game,
        game.scheduledAt,
        game.fieldName,
        occupancy,
        game.durationMinutes,
      )
    ) {
      throw new Error(
        `occupiedGames[${index}] conflicts with another occupied field or team slot`,
      );
    }

    occupyScheduleSlot(
      game,
      game.scheduledAt,
      game.fieldName,
      occupancy,
      game.durationMinutes,
    );
  }

  return occupancy;
}

function buildScheduleFairness(
  occupiedGames: readonly NormalizedOccupiedGame[],
  formatter: Intl.DateTimeFormat,
): ScheduleFairness {
  const fairness: ScheduleFairness = new Map();

  for (const game of occupiedGames) {
    const { hour, minute } = getFormattedDateTimeParts(
      game.scheduledAt.getTime(),
      formatter,
    );
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    recordFairnessAssignment(
      game,
      {
        time: { value: time, hour, minute },
        fieldName: game.fieldName,
      },
      fairness,
    );
  }

  return fairness;
}

function assignRoundMatchups(
  matchups: readonly IndexedMatchup[],
  firstPlayDate: CalendarDate,
  roundSlots: readonly ScheduleSlot[],
  settings: NormalizedScheduleSettings,
  occupancy: ScheduleOccupancy,
  fairness: ScheduleFairness,
): { assignments: RoundAssignment[]; finalDate: CalendarDate } {
  const one = BigInt(1);
  const zero = BigInt(0);
  const fullMask = (one << BigInt(matchups.length)) - one;
  let states = new Map<bigint, RoundAssignmentState>([
    [zero, { assignments: [], fairnessCost: 0 }],
  ]);
  let playDate = firstPlayDate;
  let candidateSequence = 0;

  while (true) {
    for (const slot of roundSlots) {
      const candidate: CandidateScheduleSlot = {
        ...slot,
        scheduledAt: localDateTimeToUtc(playDate, slot.time, settings),
        sequence: candidateSequence,
      };
      candidateSequence += 1;
      const nextStates = new Map(states);

      for (const [mask, state] of states) {
        for (
          let matchupPosition = 0;
          matchupPosition < matchups.length;
          matchupPosition += 1
        ) {
          const bit = one << BigInt(matchupPosition);

          if ((mask & bit) !== zero) {
            continue;
          }

          const matchup = matchups[matchupPosition].matchup;
          const tentativeOccupancy = state.assignments.map((assignment) => {
            const assignedMatchup = matchups[assignment.matchupPosition].matchup;
            return makeOccupancyEntry(
              assignedMatchup,
              assignment.candidate.scheduledAt,
              assignment.candidate.fieldName,
              settings.gameDurationMinutes,
            );
          });

          if (
            !isSlotAvailable(
              matchup,
              candidate.scheduledAt,
              candidate.fieldName,
              [...occupancy, ...tentativeOccupancy],
              settings.gameDurationMinutes,
            )
          ) {
            continue;
          }

          const nextMask = mask | bit;
          const nextState = {
            assignments: [
              ...state.assignments,
              { candidate, matchupPosition },
            ],
            fairnessCost:
              state.fairnessCost +
              getFairnessCost(matchup, candidate, fairness),
          };
          const existingState = nextStates.get(nextMask);

          if (
            !existingState ||
            compareRoundAssignmentStates(nextState, existingState) < 0
          ) {
            nextStates.set(nextMask, nextState);
          }
        }
      }

      states = nextStates;
    }

    const completedState = states.get(fullMask);

    if (completedState) {
      return {
        assignments: completedState.assignments,
        finalDate: playDate,
      };
    }

    playDate = findNextPlayDate(
      addCalendarDays(playDate, 1),
      settings.gameDays,
    );
  }
}

function compareRoundAssignmentStates(
  left: RoundAssignmentState,
  right: RoundAssignmentState,
): number {
  for (let index = 0; index < left.assignments.length; index += 1) {
    const sequenceDifference =
      left.assignments[index].candidate.sequence -
      right.assignments[index].candidate.sequence;

    if (sequenceDifference !== 0) {
      return sequenceDifference;
    }
  }

  if (left.fairnessCost !== right.fairnessCost) {
    return left.fairnessCost - right.fairnessCost;
  }

  for (let index = 0; index < left.assignments.length; index += 1) {
    const matchupDifference =
      left.assignments[index].matchupPosition -
      right.assignments[index].matchupPosition;

    if (matchupDifference !== 0) {
      return matchupDifference;
    }
  }

  return 0;
}

function getFairnessCost(
  matchup: RoundRobinMatchup,
  slot: ScheduleSlot,
  fairness: ScheduleFairness,
): number {
  const timeKey = slot.time.value;
  const fieldKey = getFieldKey(slot.fieldName);
  const slotKey = getFairnessSlotKey(timeKey, fieldKey);

  return [matchup.home.trim(), matchup.away.trim()].reduce((cost, team) => {
    const counts = fairness.get(team);

    return (
      cost +
      getIncrementalSquareCost(counts?.times.get(timeKey) ?? 0) +
      getIncrementalSquareCost(counts?.fields.get(fieldKey) ?? 0) +
      getIncrementalSquareCost(counts?.slots.get(slotKey) ?? 0)
    );
  }, 0);
}

function recordFairnessAssignment(
  matchup: RoundRobinMatchup,
  slot: ScheduleSlot,
  fairness: ScheduleFairness,
): void {
  const timeKey = slot.time.value;
  const fieldKey = getFieldKey(slot.fieldName);
  const slotKey = getFairnessSlotKey(timeKey, fieldKey);

  for (const team of [matchup.home.trim(), matchup.away.trim()]) {
    let counts = fairness.get(team);

    if (!counts) {
      counts = {
        fields: new Map(),
        slots: new Map(),
        times: new Map(),
      };
      fairness.set(team, counts);
    }

    incrementCount(counts.times, timeKey);
    incrementCount(counts.fields, fieldKey);
    incrementCount(counts.slots, slotKey);
  }
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function getIncrementalSquareCost(currentCount: number): number {
  return currentCount * 2 + 1;
}

function getFairnessSlotKey(time: string, field: string): string {
  return `${time}\u0000${field}`;
}

function isSlotAvailable(
  matchup: RoundRobinMatchup,
  scheduledAt: Date,
  fieldName: string | null,
  occupancy: ScheduleOccupancy,
  durationMinutes: number,
): boolean {
  const startsAt = scheduledAt.getTime();
  const endsAt = startsAt + durationMinutes * 60 * 1000;
  const fieldKey = getFieldKey(fieldName);
  const teams = new Set([matchup.home.trim(), matchup.away.trim()]);

  return occupancy.every(
    (occupied) =>
      !intervalsOverlap(startsAt, endsAt, occupied.startsAt, occupied.endsAt) ||
      (occupied.fieldName !== fieldKey &&
        [...teams].every((team) => !occupied.teams.has(team))),
  );
}

function occupyScheduleSlot(
  matchup: RoundRobinMatchup,
  scheduledAt: Date,
  fieldName: string | null,
  occupancy: ScheduleOccupancy,
  durationMinutes: number,
): void {
  occupancy.push({
    ...makeOccupancyEntry(matchup, scheduledAt, fieldName, durationMinutes),
  });
}

function makeOccupancyEntry(
  matchup: RoundRobinMatchup,
  scheduledAt: Date,
  fieldName: string | null,
  durationMinutes: number,
): ScheduleOccupancyEntry {
  const startsAt = scheduledAt.getTime();
  return {
    startsAt,
    endsAt: startsAt + durationMinutes * 60 * 1000,
    fieldName: getFieldKey(fieldName),
    teams: new Set([matchup.home.trim(), matchup.away.trim()]),
  };
}

function intervalsOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function normalizeGameDuration(value: number): number {
  if (!Number.isInteger(value) || value < 15 || value > 480) {
    throw new Error("gameDurationMinutes must be a whole number from 15 through 480");
  }

  return value;
}

function getFieldKey(fieldName: string | null): string {
  return fieldName === null ? "\u0000unnamed-field" : fieldName.trim().toLowerCase();
}

function getCalendarDateInTimeZone(
  date: Date,
  formatter: Intl.DateTimeFormat,
): CalendarDate {
  const { year, month, day } = getFormattedDateTimeParts(
    date.getTime(),
    formatter,
  );

  return { year, month, day };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return calendarDateToUtcMilliseconds(left) - calendarDateToUtcMilliseconds(right);
}

function rotateItems<T>(items: readonly T[], offset: number): T[] {
  if (items.length < 2 || offset === 0) {
    return [...items];
  }

  return [...items.slice(offset), ...items.slice(0, offset)];
}

function parseStartDate(value: string): CalendarDate {
  if (typeof value !== "string") {
    throw new Error("startDate must be a valid date in YYYY-MM-DD format");
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error("startDate must be a valid date in YYYY-MM-DD format");
  }

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrippedDate = new Date(calendarDateToUtcMilliseconds(date));

  if (
    date.year < 1 ||
    roundTrippedDate.getUTCFullYear() !== date.year ||
    roundTrippedDate.getUTCMonth() + 1 !== date.month ||
    roundTrippedDate.getUTCDate() !== date.day
  ) {
    throw new Error("startDate must be a valid date in YYYY-MM-DD format");
  }

  return date;
}

function normalizeGameDays(values: readonly number[]): ReadonlySet<number> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("gameDays must contain at least one weekday from 0 through 6");
  }

  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 6)) {
    throw new Error("gameDays must contain only integer weekdays from 0 through 6");
  }

  if (new Set(values).size !== values.length) {
    throw new Error("gameDays must not contain duplicate weekdays");
  }

  return new Set(values);
}

function normalizeGameTimes(values: readonly string[]): GameTime[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("gameTimes must contain at least one time in HH:mm format");
  }

  const gameTimes = values.map((value) => {
    if (typeof value !== "string") {
      throw new Error("gameTimes must contain only normalized times in HH:mm format");
    }

    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

    if (!match) {
      throw new Error("gameTimes must contain only normalized times in HH:mm format");
    }

    return {
      value,
      hour: Number(match[1]),
      minute: Number(match[2]),
    };
  });

  if (new Set(gameTimes.map(({ value }) => value)).size !== gameTimes.length) {
    throw new Error("gameTimes must not contain duplicate times");
  }

  return gameTimes.sort((left, right) =>
    left.value < right.value ? -1 : left.value > right.value ? 1 : 0,
  );
}

function normalizeFieldNames(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    throw new Error("fieldNames must be an array");
  }

  const fieldNames = values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("fieldNames must contain only non-empty names");
    }

    return value.trim();
  });

  if (new Set(fieldNames.map((fieldName) => getFieldKey(fieldName))).size !== fieldNames.length) {
    throw new Error("fieldNames must not contain duplicate names");
  }

  return fieldNames;
}

function normalizeTimeZone(value: string): {
  timeZone: string;
  formatter: Intl.DateTimeFormat;
} {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("timeZone must be a valid IANA time zone");
  }

  const timeZone = value.trim();

  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    // Some runtimes defer validating the time zone until the formatter is used.
    formatter.format(new Date(0));

    return { timeZone, formatter };
  } catch {
    throw new Error("timeZone must be a valid IANA time zone");
  }
}

function validateMatchup(
  matchup: RoundRobinMatchup,
  index: number,
  source = "matchups",
): void {
  if (!matchup || typeof matchup !== "object") {
    throw new Error(`${source}[${index}] must be a matchup object`);
  }

  if (!Number.isInteger(matchup.round) || matchup.round < 1) {
    throw new Error(`${source}[${index}].round must be a positive integer`);
  }

  if (typeof matchup.home !== "string" || matchup.home.trim().length === 0) {
    throw new Error(`${source}[${index}].home must be a non-empty team name`);
  }

  if (typeof matchup.away !== "string" || matchup.away.trim().length === 0) {
    throw new Error(`${source}[${index}].away must be a non-empty team name`);
  }

  if (matchup.home.trim() === matchup.away.trim()) {
    throw new Error(`${source}[${index}] must contain two different teams`);
  }
}

function buildScheduleSlots(
  settings: NormalizedScheduleSettings,
): ScheduleSlot[] {
  const fields = settings.fieldNames.length > 0 ? settings.fieldNames : [null];

  return settings.gameTimes.flatMap((time) =>
    fields.map((fieldName) => ({ time, fieldName })),
  );
}

function findNextPlayDate(
  firstPossibleDate: CalendarDate,
  gameDays: ReadonlySet<number>,
): CalendarDate {
  let candidate = firstPossibleDate;

  for (let daysChecked = 0; daysChecked < 7; daysChecked += 1) {
    const date = new Date(calendarDateToUtcMilliseconds(candidate));

    if (gameDays.has(date.getUTCDay())) {
      return candidate;
    }

    candidate = addCalendarDays(candidate, 1);
  }

  // normalizeGameDays guarantees at least one allowed day, so this is unreachable.
  throw new Error("could not find an allowed play date");
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(calendarDateToUtcMilliseconds(date));
  result.setUTCDate(result.getUTCDate() + days);

  if (Number.isNaN(result.getTime())) {
    throw new Error("schedule exceeds the supported calendar date range");
  }

  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function localDateTimeToUtc(
  date: CalendarDate,
  time: GameTime,
  settings: TimeZoneContext,
): Date {
  const wallClockMilliseconds = calendarDateToUtcMilliseconds(
    date,
    time.hour,
    time.minute,
  );
  const possibleOffsets = new Set<number>();
  const twelveHours = 12 * 60 * 60 * 1000;

  // Sampling on both sides of the local time captures both offsets at daylight-
  // saving transitions as well as less-common non-hour and date-line changes.
  for (let offset = -4; offset <= 4; offset += 1) {
    const sample = wallClockMilliseconds + offset * twelveHours;
    possibleOffsets.add(getTimeZoneOffset(sample, settings.formatter));
  }

  const candidates = [...possibleOffsets]
    .map((offset) => wallClockMilliseconds - offset)
    .filter((candidate) =>
      formattedDateTimeMatches(
        candidate,
        date,
        time,
        settings.formatter,
      ),
    )
    .sort((left, right) => left - right);

  if (candidates.length === 0) {
    throw new Error(
      `scheduled local time ${formatCalendarDate(date)} ${time.value} does not exist in timeZone ${settings.timeZone}`,
    );
  }

  return new Date(candidates[0]);
}

function getTimeZoneOffset(
  utcMilliseconds: number,
  formatter: Intl.DateTimeFormat,
): number {
  const parts = getFormattedDateTimeParts(utcMilliseconds, formatter);
  const formattedAsUtc = calendarDateToUtcMilliseconds(
    parts,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const wholeSecondInstant = Math.floor(utcMilliseconds / 1000) * 1000;

  return formattedAsUtc - wholeSecondInstant;
}

function formattedDateTimeMatches(
  utcMilliseconds: number,
  expectedDate: CalendarDate,
  expectedTime: GameTime,
  formatter: Intl.DateTimeFormat,
): boolean {
  const actual = getFormattedDateTimeParts(utcMilliseconds, formatter);

  return (
    actual.year === expectedDate.year &&
    actual.month === expectedDate.month &&
    actual.day === expectedDate.day &&
    actual.hour === expectedTime.hour &&
    actual.minute === expectedTime.minute &&
    actual.second === 0
  );
}

function getFormattedDateTimeParts(
  utcMilliseconds: number,
  formatter: Intl.DateTimeFormat,
): CalendarDate & { hour: number; minute: number; second: number } {
  const values = new Map(
    formatter
      .formatToParts(new Date(utcMilliseconds))
      .filter(({ type }) =>
        ["year", "month", "day", "hour", "minute", "second"].includes(type),
      )
      .map(({ type, value }) => [type, Number(value)]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error("could not resolve a scheduled time in the configured timeZone");
  }

  return { year, month, day, hour, minute, second };
}

function calendarDateToUtcMilliseconds(
  date: CalendarDate,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const result = new Date(0);
  result.setUTCFullYear(date.year, date.month - 1, date.day);
  result.setUTCHours(hour, minute, second, 0);

  return result.getTime();
}

function formatCalendarDate(date: CalendarDate): string {
  return [date.year, date.month, date.day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function resolveHomeAway(
  firstTeam: string,
  secondTeam: string,
  roundIndex: number,
  pairIndex: number,
  cycle: number,
): [string, string] {
  let swapHomeAway = pairIndex === 0 ? roundIndex % 2 === 1 : pairIndex % 2 === 0;

  if (cycle % 2 === 1) {
    swapHomeAway = !swapHomeAway;
  }

  return swapHomeAway ? [secondTeam, firstTeam] : [firstTeam, secondTeam];
}

function rotateTeams<T>(teams: T[]): T[] {
  const [fixedTeam, ...rotatingTeams] = teams;
  const lastTeam = rotatingTeams[rotatingTeams.length - 1];

  return [fixedTeam, lastTeam, ...rotatingTeams.slice(0, -1)];
}
