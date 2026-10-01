import { randomUUID } from "node:crypto";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import { recordLeagueActivity } from "@/lib/league-activity";
import type { LeagueDocumentV1, PortableJsonValue } from "@/lib/portable";

export type ImportPreviewSummary = {
  activityCount: number;
  gameCount: number;
  leagueName: string;
  managerCount: number;
  pendingOperationCount: number;
  pendingReportCount: number;
  reportCount: number;
  resultCount: number;
  schemaVersion: number;
  sourceRevision: number;
  teamCount: number;
  warnings: string[];
};

export function summarizeCreateCopy(document: LeagueDocumentV1): ImportPreviewSummary {
  const privateData = document.privateData;
  return {
    activityCount: privateData?.activity.length ?? 0,
    gameCount: document.games.length,
    leagueName: document.league.name,
    managerCount: privateData?.managers.length ?? 0,
    pendingOperationCount: document.sync?.pendingOperations.length ?? 0,
    pendingReportCount:
      privateData?.reports.filter((report) => report.status === "PENDING").length ?? 0,
    reportCount: privateData?.reports.length ?? 0,
    resultCount: document.results.length,
    schemaVersion: document.schemaVersion,
    sourceRevision: document.dataRevision,
    teamCount: document.teams.length,
    warnings: [
      "The signed-in, verified account becomes organizer of the new connected copy.",
      "Manager contacts are preserved as pending assignments, but nobody receives access until invited again.",
      "Imported audit actors are labelled as unverified history.",
      ...(privateData?.reports.some((report) => report.status === "PENDING")
        ? ["Pending reports become non-actionable imported history."]
        : []),
      ...(document.sync?.pendingOperations.length
        ? ["Queued offline operations are not replayed when creating a copy; the document's materialized data is used."]
        : []),
    ],
  };
}

export async function createLeagueCopyFromDocument(
  tx: Prisma.TransactionClient,
  document: LeagueDocumentV1,
  organizerEmail: string,
): Promise<{ id: string; slug: string }> {
  if (document.export.scope !== "organizer-backup" || !document.privateData) {
    throw new Error("Only a complete organizer backup can create a league copy.");
  }

  const now = new Date(latestDocumentTime(document));
  const leagueId = portableId("league");
  const teamIds = new Map(
    document.teams.map((team) => [team.id, portableId("team")]),
  );
  const gameIds = new Map(
    document.games.map((game) => [game.id, portableId("game")]),
  );
  const slug = await uniqueCopySlug(tx, document.league.slug);
  const schedule = document.league.schedule;

  const league = await tx.league.create({
    data: {
      archivedAt: document.league.archivedAt
        ? new Date(document.league.archivedAt)
        : null,
      commissionerEmail: organizerEmail.trim().toLocaleLowerCase(),
      createdAt: new Date(document.league.createdAt),
      dataRevision: 1,
      fieldNames: schedule.fields.length ? schedule.fields.join("\n") : null,
      gameDays:
        schedule.startDate && schedule.weekdays.length
          ? schedule.weekdays.join(",")
          : null,
      gameDurationMinutes: schedule.durationMinutes,
      gameTimes:
        schedule.startDate && schedule.startTimes.length
          ? schedule.startTimes.join("\n")
          : null,
      id: leagueId,
      lossPoints: document.league.scoring.lossPoints,
      name: `${document.league.name.slice(0, 75).trimEnd()} copy`,
      publicUpdatedAt: now,
      scheduleStartDate: schedule.startDate,
      seasonLabel: document.league.seasonLabel,
      showStandings: document.league.scoring.showStandings,
      slug,
      sport: document.league.sport,
      tiePoints: document.league.scoring.tiePoints,
      timezone: document.league.timeZone,
      updatedAt: now,
      venueAddress: document.league.venue.address,
      venueName: document.league.venue.name,
      venueUrl: document.league.venue.url,
      version: 1,
      winPoints: document.league.scoring.winPoints,
    },
    select: { id: true, slug: true },
  });

  await tx.team.createMany({
    data: document.teams.map((team) => ({
      createdAt: new Date(team.createdAt),
      id: requiredMapping(teamIds, team.id, "team"),
      leagueId,
      name: team.name,
      updatedAt: new Date(team.updatedAt),
      version: 1,
    })),
  });

  await tx.game.createMany({
    data: document.games.map((game) => ({
      awayTeamId: requiredMapping(teamIds, game.awayTeamId, "away team"),
      createdAt: new Date(game.createdAt),
      fieldName: game.fieldName,
      homeTeamId: requiredMapping(teamIds, game.homeTeamId, "home team"),
      id: requiredMapping(gameIds, game.id, "game"),
      leagueId,
      locked: game.locked,
      round: game.round,
      scheduledAt: game.scheduled ? new Date(game.scheduled.utc) : null,
      status: game.status,
      updatedAt: new Date(game.updatedAt),
      version: 1,
    })),
  });

  if (document.results.length) {
    await tx.result.createMany({
      data: document.results.map((result) => ({
        awayScore: result.awayScore,
        gameId: requiredMapping(gameIds, result.gameId, "result game"),
        homeScore: result.homeScore,
        id: portableId("result"),
        submittedAt: new Date(result.submittedAt),
        updatedAt: new Date(result.updatedAt),
        version: 1,
      })),
    });
  }

  if (document.privateData.managers.length) {
    await tx.teamManager.createMany({
      data: document.privateData.managers.map((manager) => ({
        acceptedAt: null,
        createdAt: new Date(manager.createdAt),
        email: manager.email,
        id: portableId("manager"),
        leagueId,
        teamId: requiredMapping(teamIds, manager.teamId, "manager team"),
        updatedAt: now,
        version: 1,
      })),
    });
  }

  if (document.privateData.reports.length) {
    await tx.gameReport.createMany({
      data: document.privateData.reports.map((report) => {
        const wasPending = report.status === "PENDING";
        return {
          awayScore: report.awayScore,
          createdAt: new Date(report.createdAt),
          decisionNote: wasPending
            ? "Imported as history; submit a fresh report if action is still needed."
            : report.decisionNote,
          gameId: requiredMapping(gameIds, report.gameId, "report game"),
          gameVersion: 1,
          homeScore: report.homeScore,
          id: portableId("report"),
          leagueId,
          note: report.note,
          pendingKey: null,
          proposedFieldName: report.proposedFieldName,
          proposedScheduledAt: report.proposedScheduled
            ? new Date(report.proposedScheduled.utc)
            : null,
          reviewedAt: wasPending
            ? now
            : report.reviewedAt
              ? new Date(report.reviewedAt)
              : now,
          reviewedByEmail: null,
          status: wasPending ? "REJECTED" : report.status,
          submittedByEmail: report.submittedByEmail,
          teamId: requiredMapping(teamIds, report.teamId, "report team"),
          type: report.type,
          updatedAt: now,
          version: 1,
        };
      }),
    });
  }

  if (document.privateData.activity.length) {
    await tx.activityEvent.createMany({
      data: document.privateData.activity.map((event) => ({
        actorEmail: null,
        actorRole: "IMPORT",
        createdAt: new Date(event.createdAt),
        detailsJson: JSON.stringify({
          importedActorEmail: event.actorEmail,
          importedActorRole: event.actorRole,
          importedDetails: event.details,
          importedType: event.type,
        } satisfies Record<string, PortableJsonValue>),
        gameId: event.gameId ? gameIds.get(event.gameId) ?? null : null,
        id: portableId("activity"),
        leagueId,
        operationId: null,
        summary: `[Imported history] ${event.summary}`.slice(0, 500),
        teamId: event.teamId ? teamIds.get(event.teamId) ?? null : null,
        type: "IMPORTED_HISTORY",
      })),
    });
  }

  await recordLeagueActivity(tx, {
    actorEmail: organizerEmail,
    actorRole: "IMPORT",
    details: {
      sourceDocumentId: document.documentId,
      sourceRevision: document.dataRevision,
    },
    leagueId,
    summary: `Created this league from the portable backup for ${document.league.name}.`,
    type: "LEAGUE_IMPORTED_AS_COPY",
  });

  return league;
}

function portableId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function requiredMapping(
  mapping: Map<string, string>,
  sourceId: string,
  label: string,
): string {
  const mapped = mapping.get(sourceId);
  if (!mapped) throw new Error(`Missing ${label} mapping.`);
  return mapped;
}

async function uniqueCopySlug(
  tx: Prisma.TransactionClient,
  sourceSlug: string,
): Promise<string> {
  const base = `${sourceSlug}-copy`.slice(0, 86).replace(/-+$/g, "") || "league-copy";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await tx.league.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function latestDocumentTime(document: LeagueDocumentV1): number {
  return Math.max(
    Date.now(),
    Date.parse(document.league.createdAt),
    Date.parse(document.league.publicUpdatedAt),
    Date.parse(document.league.updatedAt),
    ...document.teams.flatMap((team) => [
      Date.parse(team.createdAt),
      Date.parse(team.updatedAt),
    ]),
    ...document.games.flatMap((game) => [
      Date.parse(game.createdAt),
      Date.parse(game.updatedAt),
    ]),
    ...document.results.flatMap((result) => [
      Date.parse(result.submittedAt),
      Date.parse(result.updatedAt),
    ]),
    ...(document.privateData?.managers.flatMap((manager) => [
      Date.parse(manager.createdAt),
      Date.parse(manager.updatedAt),
      manager.acceptedAt ? Date.parse(manager.acceptedAt) : 0,
    ]) ?? []),
    ...(document.privateData?.reports.flatMap((report) => [
      Date.parse(report.createdAt),
      Date.parse(report.updatedAt),
      report.reviewedAt ? Date.parse(report.reviewedAt) : 0,
    ]) ?? []),
    ...(document.privateData?.activity.map((event) => Date.parse(event.createdAt)) ?? []),
  );
}
