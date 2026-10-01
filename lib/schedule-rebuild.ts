import { createHash } from "node:crypto";

import {
  assignSchedule,
  type ScheduleSettings,
  zonedDateTimeToUtc,
} from "./schedule";

export type RebuildSourceGame = {
  away: string;
  fieldName: string | null;
  hasResult: boolean;
  home: string;
  id: string;
  locked: boolean;
  round: number;
  scheduledAt: Date | null;
  status: string;
  version: number;
};

export type RebuildSchedulePlan = {
  preserved: Array<{ id: string; scheduledAt: Date }>;
  rebuilt: Array<{
    fieldName: string | null;
    id: string;
    moved: boolean;
    scheduledAt: Date;
  }>;
};

export function buildRebuildSchedulePlan(
  sourceGames: RebuildSourceGame[],
  currentTimeZone: string,
  settings: ScheduleSettings,
): RebuildSchedulePlan {
  const games = [...sourceGames].sort(
    (left, right) => left.round - right.round || left.id.localeCompare(right.id),
  );
  const gamesToRebuild = games.filter((game) => !game.hasResult && !game.locked);
  const preservedTimes = new Map<string, Date>();

  if (currentTimeZone !== settings.timeZone) {
    for (const game of games) {
      if ((!game.hasResult && !game.locked) || !game.scheduledAt) continue;
      const wallClock = getWallClock(game.scheduledAt, currentTimeZone);
      preservedTimes.set(
        game.id,
        zonedDateTimeToUtc(wallClock.date, wallClock.time, settings.timeZone),
      );
    }
  }

  const occupiedGames = games.flatMap((game) =>
    (game.hasResult || game.locked) &&
    game.scheduledAt &&
    game.status !== "RAINED_OUT"
      ? [
          {
            away: game.away,
            durationMinutes: settings.gameDurationMinutes,
            fieldName: game.fieldName,
            home: game.home,
            round: game.round,
            scheduledAt: preservedTimes.get(game.id) ?? game.scheduledAt,
          },
        ]
      : [],
  );
  const assigned = assignSchedule(
    gamesToRebuild.map((game) => ({
      away: game.away,
      home: game.home,
      round: game.round,
    })),
    settings,
    { occupiedGames },
  );

  return {
    preserved: [...preservedTimes].map(([id, scheduledAt]) => ({
      id,
      scheduledAt,
    })),
    rebuilt: gamesToRebuild.map((game, index) => {
      const slot = assigned[index];
      return {
        fieldName: slot.fieldName,
        id: game.id,
        moved:
          !game.scheduledAt ||
          game.scheduledAt.getTime() !== slot.scheduledAt.getTime() ||
          (game.fieldName?.trim() ?? "") !== (slot.fieldName?.trim() ?? ""),
        scheduledAt: slot.scheduledAt,
      };
    }),
  };
}

export function schedulePreviewFingerprint(
  games: Array<{ id: string; version: number }>,
  settings: ScheduleSettings,
): string {
  const payload = {
    games: [...games]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((game) => [game.id, game.version]),
    settings: {
      fieldNames: settings.fieldNames,
      gameDays: settings.gameDays,
      gameDurationMinutes: settings.gameDurationMinutes,
      gameTimes: settings.gameTimes,
      startDate: settings.startDate,
      timeZone: settings.timeZone,
    },
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function getWallClock(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}
