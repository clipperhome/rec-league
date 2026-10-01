import { randomUUID } from "node:crypto";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import { db } from "@/lib/db";
import { findGameConflict } from "@/lib/game-conflicts";
import { managerReportRuleViolation } from "@/lib/manager-report-rules";
import type {
  PortableJsonValue,
  PortableOperation,
} from "@/lib/portable";

import {
  PortableOperationError,
  runIdempotentLeagueOperation,
  type PortableOperationActor,
  type PortableOperationExecution,
} from "./operations";

export class ApplyOperationError extends Error {
  constructor(
    readonly result: "conflict" | "rejected",
    message: string,
  ) {
    super(message);
    this.name = "ApplyOperationError";
  }
}

export async function applyPortableOperation(
  leagueId: string,
  actor: PortableOperationActor,
  operation: PortableOperation,
): Promise<PortableOperationExecution<PortableJsonValue>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(
        (tx) => applyPortableOperationInTransaction(tx, leagueId, actor, operation),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryableDatabaseConflict(error)) continue;
      throw normalizeOperationError(error);
    }
  }
  throw normalizeOperationError(lastError);
}

export async function applyPortableOperationInTransaction(
  tx: Prisma.TransactionClient,
  leagueId: string,
  actor: PortableOperationActor,
  operation: PortableOperation,
): Promise<PortableOperationExecution<PortableJsonValue>> {
  assertRoleCanRun(actor, operation);
  const activity = activityFor(operation);

  return runIdempotentLeagueOperation(
    tx,
    {
      actor,
      activity,
      allowArchived:
        actor.role === "ORGANIZER" && operation.kind === "ARCHIVE_LEAGUE",
      baseRevision: operation.baseRevision,
      leagueId,
      operationId: operation.operationId,
      operationType: operation.kind,
      payload: operation.payload as PortableJsonValue,
    },
    () => mutateOperation(tx, leagueId, actor, operation),
  );
}

async function mutateOperation(
  tx: Prisma.TransactionClient,
  leagueId: string,
  actor: PortableOperationActor,
  operation: PortableOperation,
): Promise<PortableJsonValue> {
  switch (operation.kind) {
    case "SET_SCORE": {
      const { awayScore, expectedGameVersion, gameId, homeScore } = operation.payload;
      const changed = await tx.game.updateMany({
        where: {
          id: gameId,
          leagueId,
          locked: false,
          version: expectedGameVersion,
        },
        data: { status: "COMPLETED", version: { increment: 1 } },
      });
      if (changed.count !== 1) throw conflict("The game changed or is locked.");
      await tx.result.upsert({
        where: { gameId },
        create: { awayScore, gameId, homeScore },
        update: { awayScore, homeScore, version: { increment: 1 } },
      });
      await supersedeReports(tx, gameId, actor.email);
      return { gameId, gameVersion: expectedGameVersion + 1 };
    }

    case "MARK_RAINOUT": {
      const { expectedGameVersion, gameId } = operation.payload;
      const changed = await tx.game.updateMany({
        where: {
          id: gameId,
          leagueId,
          locked: false,
          version: expectedGameVersion,
        },
        data: {
          locked: false,
          status: "RAINED_OUT",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw conflict("The game changed or is locked.");
      await tx.result.deleteMany({ where: { gameId } });
      await supersedeReports(tx, gameId, actor.email);
      return { gameId, gameVersion: expectedGameVersion + 1 };
    }

    case "RESCHEDULE_GAME": {
      const { expectedGameVersion, fieldName, gameId, scheduled } = operation.payload;
      const current = await tx.game.findFirst({
        where: { id: gameId, leagueId },
        include: { league: true, result: { select: { id: true } } },
      });
      if (!current || current.version !== expectedGameVersion || current.locked) {
        throw conflict("The game changed, was removed, or is locked.");
      }
      if (scheduled.timeZone !== current.league.timezone) {
        throw conflict(
          "The league time zone changed after this reschedule was prepared.",
        );
      }
      const scheduledAt = new Date(scheduled.utc);
      const games = await tx.game.findMany({
        where: { id: { not: gameId }, leagueId },
        select: {
          awayTeamId: true,
          fieldName: true,
          homeTeamId: true,
          id: true,
          scheduledAt: true,
          status: true,
        },
      });
      const overlap = findGameConflict(
        {
          awayTeamId: current.awayTeamId,
          fieldName,
          homeTeamId: current.homeTeamId,
          id: gameId,
          scheduledAt,
        },
        games,
        current.league.gameDurationMinutes,
      );
      if (overlap) throw conflict(`The proposed slot overlaps game ${overlap.id}.`);
      const changed = await tx.game.updateMany({
        where: { id: gameId, leagueId, locked: false, version: expectedGameVersion },
        data: {
          fieldName,
          scheduledAt,
          status: current.result ? "COMPLETED" : "RESCHEDULED",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw conflict("The game changed while syncing.");
      await supersedeReports(tx, gameId, actor.email);
      return { gameId, gameVersion: expectedGameVersion + 1 };
    }

    case "UPDATE_LEAGUE": {
      const { changes, expectedLeagueVersion } = operation.payload;
      if (changes.schedule || changes.timeZone) {
        throw rejected(
          "Schedule rhythm and time-zone changes need an online rebuild preview.",
        );
      }
      const data: Prisma.LeagueUpdateManyMutationInput = {
        version: { increment: 1 },
      };
      if (changes.name !== undefined) data.name = changes.name;
      if (changes.seasonLabel !== undefined) data.seasonLabel = changes.seasonLabel;
      if (changes.sport !== undefined) data.sport = changes.sport;
      if (changes.scoring) {
        data.lossPoints = changes.scoring.lossPoints;
        data.showStandings = changes.scoring.showStandings;
        data.tiePoints = changes.scoring.tiePoints;
        data.winPoints = changes.scoring.winPoints;
      }
      if (changes.venue) {
        data.venueAddress = changes.venue.address;
        data.venueName = changes.venue.name;
        data.venueUrl = changes.venue.url;
      }
      const changed = await tx.league.updateMany({
        where: { archivedAt: null, id: leagueId, version: expectedLeagueVersion },
        data,
      });
      if (changed.count !== 1) throw conflict("League settings changed while offline.");
      return { leagueId, leagueVersion: expectedLeagueVersion + 1 };
    }

    case "ARCHIVE_LEAGUE": {
      const { archived, expectedLeagueVersion } = operation.payload;
      const changed = await tx.league.updateMany({
        where: { id: leagueId, version: expectedLeagueVersion },
        data: {
          archivedAt: archived ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw conflict("League lifecycle changed while offline.");
      return { archived, leagueId, leagueVersion: expectedLeagueVersion + 1 };
    }

    case "RENAME_TEAM": {
      const { expectedTeamVersion, name, teamId } = operation.payload;
      const allNames = await tx.team.findMany({
        where: { id: { not: teamId }, leagueId },
        select: { name: true },
      });
      if (
        allNames.some(
          (team) => team.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
        )
      ) {
        throw conflict("Another team already uses that name.");
      }
      const changed = await tx.team.updateMany({
        where: { id: teamId, leagueId, version: expectedTeamVersion },
        data: { name, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw conflict("The team changed or was removed.");
      return { teamId, teamVersion: expectedTeamVersion + 1 };
    }

    case "SUBMIT_REPORT": {
      if (actor.role !== "MANAGER") {
        throw rejected("Only an accepted team manager can submit this operation.");
      }
      const payload = operation.payload;
      if (payload.teamId !== actor.teamId) {
        throw rejected("A manager can submit reports only for their assigned team.");
      }
      validateReportPayload(payload);
      const game = await tx.game.findFirst({
        where: { id: payload.gameId, leagueId },
        select: {
          awayTeamId: true,
          homeTeamId: true,
          league: {
            select: { gameDurationMinutes: true, timezone: true },
          },
          locked: true,
          result: { select: { id: true } },
          version: true,
        },
      });
      if (
        !game ||
        game.version !== payload.expectedGameVersion ||
        game.locked ||
        (game.homeTeamId !== actor.teamId && game.awayTeamId !== actor.teamId)
      ) {
        throw conflict("The official game changed or no longer belongs to this team.");
      }
      const games =
        payload.reportType === "RESCHEDULE" && payload.proposedScheduled
          ? await tx.game.findMany({
              where: { leagueId },
              select: {
                awayTeamId: true,
                fieldName: true,
                homeTeamId: true,
                id: true,
                scheduledAt: true,
                status: true,
              },
            })
          : [];
      const ruleViolation = managerReportRuleViolation({
        game: {
          awayTeamId: game.awayTeamId,
          hasResult: Boolean(game.result),
          homeTeamId: game.homeTeamId,
          id: payload.gameId,
        },
        gameDurationMinutes: game.league.gameDurationMinutes,
        games,
        leagueTimeZone: game.league.timezone,
        proposedSlot: payload.proposedScheduled
          ? {
              fieldName: payload.proposedFieldName,
              scheduledAt: new Date(payload.proposedScheduled.utc),
              timeZone: payload.proposedScheduled.timeZone,
            }
          : null,
        reportType: payload.reportType,
      });
      if (ruleViolation) throw conflict(ruleViolation);
      const pendingKey = `${payload.gameId}:${actor.teamId}:${payload.reportType}`;
      const reviewedAt = new Date();
      await tx.gameReport.updateMany({
        where: { pendingKey, status: "PENDING" },
        data: {
          decisionNote: "Replaced by a newer synchronized manager report.",
          pendingKey: null,
          reviewedAt,
          status: "REJECTED",
          version: { increment: 1 },
        },
      });
      const report = await tx.gameReport.create({
        data: {
          awayScore: payload.awayScore,
          gameId: payload.gameId,
          gameVersion: payload.expectedGameVersion,
          homeScore: payload.homeScore,
          id: `report_${randomUUID()}`,
          leagueId,
          note: payload.note,
          pendingKey,
          proposedFieldName: payload.proposedFieldName,
          proposedScheduledAt: payload.proposedScheduled
            ? new Date(payload.proposedScheduled.utc)
            : null,
          submittedByEmail: actor.email,
          teamId: actor.teamId,
          type: payload.reportType,
        },
        select: { id: true },
      });
      return { reportId: report.id };
    }

    case "ADD_TEAM":
    case "REMOVE_TEAM":
      throw rejected(
        "Team roster changes require the connected schedule-rebuild workflow.",
      );
    case "REVIEW_REPORT":
      throw rejected("Review manager reports from the connected organizer board.");
  }
}

function assertRoleCanRun(
  actor: PortableOperationActor,
  operation: PortableOperation,
) {
  if (actor.role === "MANAGER" && operation.kind !== "SUBMIT_REPORT") {
    throw rejected("Team managers can synchronize report submissions only.");
  }
  if (actor.role === "ORGANIZER" && operation.kind === "SUBMIT_REPORT") {
    throw rejected("Organizer operations cannot impersonate a team manager.");
  }
}

function activityFor(operation: PortableOperation) {
  switch (operation.kind) {
    case "SET_SCORE":
      return {
        gameId: operation.payload.gameId,
        summary: "Posted an offline final score.",
        type: "OFFLINE_SCORE_APPLIED",
      };
    case "MARK_RAINOUT":
      return {
        gameId: operation.payload.gameId,
        summary: "Applied an offline rainout.",
        type: "OFFLINE_RAINOUT_APPLIED",
      };
    case "RESCHEDULE_GAME":
      return {
        gameId: operation.payload.gameId,
        summary: "Applied an offline game reschedule.",
        type: "OFFLINE_RESCHEDULE_APPLIED",
      };
    case "UPDATE_LEAGUE":
      return {
        summary: "Applied offline league-setting changes.",
        type: "OFFLINE_LEAGUE_UPDATED",
      };
    case "ARCHIVE_LEAGUE":
      return {
        summary: operation.payload.archived
          ? "Applied an offline season archive."
          : "Applied an offline season reopen.",
        type: operation.payload.archived
          ? "OFFLINE_LEAGUE_ARCHIVED"
          : "OFFLINE_LEAGUE_REOPENED",
      };
    case "RENAME_TEAM":
      return {
        summary: "Applied an offline team rename.",
        teamId: operation.payload.teamId,
        type: "OFFLINE_TEAM_RENAMED",
      };
    case "SUBMIT_REPORT":
      return {
        gameId: operation.payload.gameId,
        summary: "Synchronized a team-manager report.",
        teamId: operation.payload.teamId,
        touchesPublicPage: false,
        type: "OFFLINE_REPORT_SUBMITTED",
      };
    case "ADD_TEAM":
    case "REMOVE_TEAM":
    case "REVIEW_REPORT":
      return {
        summary: "Attempted an unsupported offline operation.",
        touchesPublicPage: false,
        type: "OFFLINE_OPERATION_REJECTED",
      };
  }
}

function validateReportPayload(
  payload: Extract<PortableOperation, { kind: "SUBMIT_REPORT" }>['payload'],
) {
  if (
    payload.reportType === "SCORE" &&
    (payload.homeScore === null || payload.awayScore === null)
  ) {
    throw rejected("A score report needs both scores.");
  }
  if (
    payload.reportType !== "SCORE" &&
    (payload.homeScore !== null || payload.awayScore !== null)
  ) {
    throw rejected("Only score reports may contain scores.");
  }
  if (payload.reportType === "RESCHEDULE" && !payload.proposedScheduled) {
    throw rejected("A reschedule report needs a proposed date and time.");
  }
  if (
    payload.reportType !== "RESCHEDULE" &&
    (payload.proposedScheduled || payload.proposedFieldName)
  ) {
    throw rejected("Only reschedule reports may contain a proposed slot.");
  }
}

async function supersedeReports(
  tx: Prisma.TransactionClient,
  gameId: string,
  organizerEmail: string,
) {
  await tx.gameReport.updateMany({
    where: { gameId, status: "PENDING" },
    data: {
      decisionNote: "Superseded by a synchronized organizer update.",
      pendingKey: null,
      reviewedAt: new Date(),
      reviewedByEmail: organizerEmail,
      status: "REJECTED",
      version: { increment: 1 },
    },
  });
}

function conflict(message: string): ApplyOperationError {
  return new ApplyOperationError("conflict", message);
}

function rejected(message: string): ApplyOperationError {
  return new ApplyOperationError("rejected", message);
}

function normalizeOperationError(error: unknown): Error {
  if (error instanceof ApplyOperationError) return error;
  if (error instanceof PortableOperationError) {
    return new ApplyOperationError(
      error.code === "IDEMPOTENCY_CONFLICT" || error.code === "REVISION_AHEAD"
        ? "conflict"
        : "rejected",
      error.message,
    );
  }
  return error instanceof Error ? error : new Error("The operation could not be applied.");
}

function isRetryableDatabaseConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      ((error as { code?: unknown }).code === "P2002" ||
        (error as { code?: unknown }).code === "P2034"),
  );
}
