import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_URL,
  PORTABLE_SCHEMA_VERSION,
  assertPortableDocument,
  type LeagueDocumentV1,
  type PortableActivityActorRole,
  type PortableJsonValue,
  type PortableScheduledInstant,
} from "@/lib/portable";

const APP_VERSION = process.env.npm_package_version ?? "0.1.0";

export async function buildOrganizerLeagueDocument(
  tx: Prisma.TransactionClient,
  leagueId: string,
  options: {
    exportedAt?: Date;
    source?: "connected" | "local-only";
  } = {},
): Promise<LeagueDocumentV1> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    include: {
      activityEvents: true,
      games: { include: { result: true } },
      gameReports: true,
      teamManagers: true,
      teams: true,
    },
  });
  if (!league) throw new Error("League not found.");

  const document: LeagueDocumentV1 = {
    $schema: PORTABLE_SCHEMA_URL,
    dataRevision: league.dataRevision,
    documentId: league.id,
    export: {
      appVersion: APP_VERSION,
      containsPrivateData: true,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      scope: "organizer-backup",
      source: options.source ?? "connected",
    },
    format: PORTABLE_FORMAT,
    games: league.games.map((game) => ({
      awayTeamId: game.awayTeamId,
      createdAt: game.createdAt.toISOString(),
      fieldName: game.fieldName,
      homeTeamId: game.homeTeamId,
      id: game.id,
      locked: game.locked,
      round: game.round,
      scheduled: game.scheduledAt
        ? toPortableScheduledInstant(game.scheduledAt, league.timezone)
        : null,
      status: game.status,
      updatedAt: game.updatedAt.toISOString(),
      version: game.version,
    })),
    league: {
      archivedAt: league.archivedAt?.toISOString() ?? null,
      createdAt: league.createdAt.toISOString(),
      id: league.id,
      name: league.name,
      publicUpdatedAt: league.publicUpdatedAt.toISOString(),
      schedule: storedSchedule(league),
      scoring: {
        lossPoints: league.lossPoints,
        showStandings: league.showStandings,
        tiePoints: league.tiePoints,
        winPoints: league.winPoints,
      },
      seasonLabel: league.seasonLabel,
      slug: league.slug,
      sport: league.sport,
      timeZone: league.timezone,
      updatedAt: league.updatedAt.toISOString(),
      venue: {
        address: league.venueAddress,
        name: league.venueName,
        url: league.venueUrl,
      },
      version: league.version,
    },
    privateData: {
      activity: league.activityEvents.map((event) => ({
        actorEmail: event.actorEmail,
        actorRole: portableActorRole(event.actorRole),
        createdAt: event.createdAt.toISOString(),
        details: parseDetails(event.detailsJson),
        gameId: event.gameId,
        id: event.id,
        summary: event.summary,
        teamId: event.teamId,
        type: event.type,
      })),
      managers: league.teamManagers.map((manager) => ({
        acceptedAt: manager.acceptedAt?.toISOString() ?? null,
        createdAt: manager.createdAt.toISOString(),
        email: manager.email,
        id: manager.id,
        teamId: manager.teamId,
        updatedAt: manager.updatedAt.toISOString(),
        version: manager.version,
      })),
      organizerContactEmail: league.commissionerEmail,
      reports: league.gameReports.map((report) => ({
        awayScore: report.awayScore,
        createdAt: report.createdAt.toISOString(),
        decisionNote: report.decisionNote,
        gameId: report.gameId,
        gameVersion: report.gameVersion,
        homeScore: report.homeScore,
        id: report.id,
        note: report.note,
        proposedFieldName: report.proposedFieldName,
        proposedScheduled: report.proposedScheduledAt
          ? toPortableScheduledInstant(
              report.proposedScheduledAt,
              league.timezone,
            )
          : null,
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
        reviewedByEmail: report.reviewedByEmail,
        status: report.status,
        submittedByEmail: report.submittedByEmail,
        teamId: report.teamId,
        type: report.type,
        updatedAt: report.updatedAt.toISOString(),
        version: report.version,
      })),
    },
    results: league.games.flatMap((game) =>
      game.result
        ? [
            {
              awayScore: game.result.awayScore,
              gameId: game.id,
              homeScore: game.result.homeScore,
              id: game.result.id,
              submittedAt: game.result.submittedAt.toISOString(),
              updatedAt: game.result.updatedAt.toISOString(),
              version: game.result.version,
            },
          ]
        : [],
    ),
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    teams: league.teams.map((team) => ({
      createdAt: team.createdAt.toISOString(),
      id: team.id,
      name: team.name,
      updatedAt: team.updatedAt.toISOString(),
      version: team.version,
    })),
  };

  return assertPortableDocument(document);
}

export function toPortableScheduledInstant(
  instant: Date,
  timeZone: string,
): PortableScheduledInstant {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error("Could not render a scheduled instant in the league time zone.");
  }

  return {
    localDate: `${year}-${month}-${day}`,
    localTime: `${hour}:${minute}`,
    timeZone,
    utc: instant.toISOString(),
  };
}

function storedSchedule(league: {
  fieldNames: string | null;
  gameDays: string | null;
  gameDurationMinutes: number;
  gameTimes: string | null;
  scheduleStartDate: string | null;
}) {
  const hasCompleteRhythm = Boolean(
    league.scheduleStartDate && league.gameDays && league.gameTimes,
  );
  return {
    durationMinutes: league.gameDurationMinutes,
    fields: hasCompleteRhythm ? splitLines(league.fieldNames) : [],
    startDate: hasCompleteRhythm ? league.scheduleStartDate : null,
    startTimes: hasCompleteRhythm ? splitLines(league.gameTimes) : [],
    weekdays: hasCompleteRhythm
      ? (league.gameDays ?? "")
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      : [],
  };
}

function splitLines(value: string | null): string[] {
  return (value ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function portableActorRole(value: string): PortableActivityActorRole {
  return value === "IMPORT" ||
    value === "MANAGER" ||
    value === "ORGANIZER" ||
    value === "SYSTEM"
    ? value
    : "UNKNOWN";
}

function parseDetails(value: string | null): Record<string, PortableJsonValue> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, PortableJsonValue> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every(isJsonValue),
  );
}

function isJsonValue(value: unknown): value is PortableJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
