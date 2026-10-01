"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  assertActiveOrganizerInTransaction,
  AuthorizationError,
  requireCommissionerForGame,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { findGameConflict } from "@/lib/game-conflicts";
import { recordLeagueActivity } from "@/lib/league-activity";
import { zonedDateTimeToUtc } from "@/lib/schedule";

export async function submitResultAction(formData: FormData): Promise<never> {
  const gameId = readString(formData, "gameId");
  const expectedSlug = readString(formData, "slug");
  const expectedGameVersion = parseGameVersion(
    readString(formData, "expectedGameVersion"),
  );

  if (!gameId || !expectedSlug || expectedGameVersion === null) {
    throw new AuthorizationError();
  }

  const authorization = await requireCommissionerForGame(gameId, expectedSlug);
  const homeScore = parseScore(readString(formData, "homeScore"));
  const awayScore = parseScore(readString(formData, "awayScore"));

  if (homeScore === null || awayScore === null) {
    redirectWithNotice(
      authorization.slug,
      "Enter whole-number scores between 0 and 999.",
      "error",
      "all",
    );
  }

  const saved = await db.$transaction(
    async (tx) => {
      await assertActiveOrganizerInTransaction(tx, authorization);
    const unlockedGame = await tx.game.updateMany({
      where: {
        id: gameId,
        leagueId: authorization.leagueId,
        league: { archivedAt: null },
        locked: false,
        version: expectedGameVersion,
      },
      data: { status: "COMPLETED", version: { increment: 1 } },
    });

    if (unlockedGame.count !== 1) {
      const current = await tx.game.findFirst({
        where: { id: gameId, leagueId: authorization.leagueId },
        select: { locked: true },
      });
      if (!current) throw new AuthorizationError();
      return current.locked ? "locked" : "stale";
    }

    await tx.result.upsert({
      where: { gameId },
      create: { awayScore, gameId, homeScore },
      update: { awayScore, homeScore, version: { increment: 1 } },
    });
    await supersedePendingReports(tx, [gameId], authorization.email);
    await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      gameId,
      leagueId: authorization.leagueId,
      summary: "Posted an official final score.",
      type: "SCORE_POSTED",
    });
      return "saved";
    },
    { isolationLevel: "Serializable" },
  );

  if (saved !== "saved") {
    redirectWithNotice(
      authorization.slug,
      saved === "locked"
        ? "Unlock this game before changing its score."
        : "That game changed while this form was open. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  revalidateLeagueViews(authorization.slug);
  redirectWithNotice(
    authorization.slug,
    "Final score posted. Standings are up to date.",
    "success",
    "results",
  );
}

export async function markRainoutAction(formData: FormData): Promise<never> {
  const gameId = readString(formData, "gameId");
  const expectedSlug = readString(formData, "slug");
  const expectedGameVersion = parseGameVersion(
    readString(formData, "expectedGameVersion"),
  );

  if (!gameId || !expectedSlug || expectedGameVersion === null) {
    throw new AuthorizationError();
  }

  const authorization = await requireCommissionerForGame(gameId, expectedSlug);

  const saved = await db.$transaction(async (tx) => {
    await assertActiveOrganizerInTransaction(tx, authorization);
    const changedGame = await tx.game.updateMany({
      where: {
        id: gameId,
        leagueId: authorization.leagueId,
        league: { archivedAt: null },
        locked: false,
        version: expectedGameVersion,
      },
      data: {
        locked: false,
        status: "RAINED_OUT",
        version: { increment: 1 },
      },
    });
    if (changedGame.count !== 1) {
      const current = await tx.game.findFirst({
        where: { id: gameId, leagueId: authorization.leagueId },
        select: { locked: true },
      });
      if (!current) throw new AuthorizationError();
      return current.locked ? "locked" : "stale";
    }
    await tx.result.deleteMany({ where: { gameId } });
    await supersedePendingReports(tx, [gameId], authorization.email);
    await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      gameId,
      leagueId: authorization.leagueId,
      summary: "Marked a game as rained out.",
      type: "GAME_RAINED_OUT",
    });
    return "saved";
  });

  if (saved !== "saved") {
    redirectWithNotice(
      authorization.slug,
      saved === "locked"
        ? "Unlock this final before marking it as rained out."
        : "That game changed while this form was open. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  revalidateLeagueViews(authorization.slug);
  redirectWithNotice(
    authorization.slug,
    "Game marked as rained out. It now needs a new date.",
    "success",
    "attention",
  );
}

export async function updateGameScheduleAction(formData: FormData): Promise<never> {
  const gameId = readString(formData, "gameId");
  const expectedSlug = readString(formData, "slug");
  const expectedGameVersion = parseGameVersion(
    readString(formData, "expectedGameVersion"),
  );

  if (!gameId || !expectedSlug || expectedGameVersion === null) {
    throw new AuthorizationError();
  }

  const authorization = await requireCommissionerForGame(gameId, expectedSlug);
  const scheduledDate = readString(formData, "scheduledDate");
  const scheduledTime = readString(formData, "scheduledTime");
  const fieldName = readString(formData, "fieldName").trim();

  const currentGame = await db.game.findUnique({
    where: { id: gameId },
    select: {
      awayTeamId: true,
      fieldName: true,
      homeTeamId: true,
      league: {
        select: { gameDurationMinutes: true, timezone: true },
      },
      result: { select: { id: true } },
      scheduledAt: true,
      status: true,
      version: true,
    },
  });

  if (!currentGame) throw new AuthorizationError();
  if (currentGame.version !== expectedGameVersion) {
    redirectWithNotice(
      authorization.slug,
      "That game changed while you were editing it. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  let scheduledAt: Date;

  try {
    scheduledAt = zonedDateTimeToUtc(
      scheduledDate,
      scheduledTime,
      currentGame.league.timezone,
    );
  } catch {
    redirectWithNotice(
      authorization.slug,
      "Choose a valid local date and time.",
      "error",
      "all",
    );
  }

  if (fieldName.length > 80) {
    redirectWithNotice(
      authorization.slug,
      "Keep the field or court name under 80 characters.",
      "error",
      "all",
    );
  }

  const leagueGames = await db.game.findMany({
    where: {
      id: { not: gameId },
      leagueId: authorization.leagueId,
    },
    select: {
      awayTeamId: true,
      fieldName: true,
      homeTeamId: true,
      id: true,
      scheduledAt: true,
      status: true,
    },
  });
  const conflictingGame = findGameConflict(
    {
      awayTeamId: currentGame.awayTeamId,
      fieldName: fieldName || null,
      homeTeamId: currentGame.homeTeamId,
      id: gameId,
      scheduledAt,
    },
    leagueGames,
    currentGame.league.gameDurationMinutes,
  );

  if (conflictingGame) {
    redirectWithNotice(
      authorization.slug,
      "That time overlaps another game for this field or one of these teams.",
      "error",
      "all",
    );
  }

  const changedExistingDate = Boolean(
    currentGame.scheduledAt &&
      currentGame.scheduledAt.getTime() !== scheduledAt.getTime(),
  );
  const changedExistingField = Boolean(
    currentGame.scheduledAt &&
      (currentGame.fieldName?.trim() ?? "") !== fieldName,
  );
  const status = currentGame.result
    ? "COMPLETED"
    : currentGame.status === "RAINED_OUT" ||
        changedExistingDate ||
        changedExistingField
      ? "RESCHEDULED"
      : "SCHEDULED";

  let saved: "conflict" | "saved" | "stale";
  try {
    saved = await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        const latestGames = await tx.game.findMany({
      where: { id: { not: gameId }, leagueId: authorization.leagueId },
      select: {
        awayTeamId: true,
        fieldName: true,
        homeTeamId: true,
        id: true,
        scheduledAt: true,
        status: true,
      },
    });
        if (
          findGameConflict(
        {
          awayTeamId: currentGame.awayTeamId,
          fieldName: fieldName || null,
          homeTeamId: currentGame.homeTeamId,
          id: gameId,
          scheduledAt,
        },
        latestGames,
        currentGame.league.gameDurationMinutes,
          )
        ) {
          return "conflict" as const;
        }
        const changed = await tx.game.updateMany({
      where: {
        id: gameId,
        leagueId: authorization.leagueId,
        league: { archivedAt: null },
        version: expectedGameVersion,
      },
      data: {
        fieldName: fieldName || null,
        scheduledAt,
        status,
        version: { increment: 1 },
      },
    });
        if (changed.count !== 1) return "stale" as const;
        await supersedePendingReports(tx, [gameId], authorization.email);
        await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      gameId,
      leagueId: authorization.leagueId,
      summary: currentGame.scheduledAt
        ? "Updated a game date or field."
        : "Scheduled a previously undated game.",
      type: "GAME_SCHEDULE_UPDATED",
        });
        return "saved" as const;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not update the game schedule.", error);
    redirectWithNotice(
      authorization.slug,
      "The schedule changed while this form was being saved. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  if (saved === "conflict") {
    redirectWithNotice(
      authorization.slug,
      "That time now overlaps another game for this field or one of these teams.",
      "error",
      "all",
    );
  }
  if (saved === "stale") {
    redirectWithNotice(
      authorization.slug,
      "That game changed while you were editing it. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  revalidateLeagueViews(authorization.slug);
  redirectWithNotice(
    authorization.slug,
    currentGame.scheduledAt
      ? "Game details updated."
      : "Game added to the schedule.",
    "success",
    "all",
  );
}

export async function toggleLockAction(formData: FormData): Promise<never> {
  const gameId = readString(formData, "gameId");
  const expectedSlug = readString(formData, "slug");
  const expectedGameVersion = parseGameVersion(
    readString(formData, "expectedGameVersion"),
  );
  const lockAction = readString(formData, "lockAction");

  if (
    !gameId ||
    !expectedSlug ||
    expectedGameVersion === null ||
    (lockAction !== "lock" && lockAction !== "unlock")
  ) {
    throw new AuthorizationError();
  }

  const authorization = await requireCommissionerForGame(gameId, expectedSlug);
  const desiredLocked = lockAction === "lock";
  const outcome = await db.$transaction(async (tx) => {
    await assertActiveOrganizerInTransaction(tx, authorization);
    const game = await tx.game.findFirst({
      where: {
        id: gameId,
        leagueId: authorization.leagueId,
        league: { archivedAt: null },
      },
      select: { locked: true, result: { select: { id: true } }, version: true },
    });
    if (!game) throw new AuthorizationError();
    if (desiredLocked && !game.result) return "no-result" as const;
    if (game.locked === desiredLocked) return "unchanged" as const;
    if (game.version !== expectedGameVersion) return "stale" as const;

    const changed = await tx.game.updateMany({
      where: {
        id: gameId,
        leagueId: authorization.leagueId,
        locked: !desiredLocked,
        version: expectedGameVersion,
      },
      data: { locked: desiredLocked, version: { increment: 1 } },
    });
    if (changed.count !== 1) return "stale" as const;

    await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      gameId,
      leagueId: authorization.leagueId,
      summary: desiredLocked ? "Locked a final score." : "Unlocked a final score.",
      touchesPublicPage: false,
      type: desiredLocked ? "SCORE_LOCKED" : "SCORE_UNLOCKED",
    });
    return "saved" as const;
  });

  if (outcome === "no-result") {
    redirectWithNotice(
      authorization.slug,
      "Post a final score before locking it.",
      "error",
      "all",
    );
  }
  if (outcome === "stale") {
    redirectWithNotice(
      authorization.slug,
      "That game changed while this form was open. Review the latest details and try again.",
      "error",
      "all",
    );
  }

  revalidateLeagueViews(authorization.slug);
  redirectWithNotice(
    authorization.slug,
    desiredLocked ? "Final score locked." : "Score editing unlocked.",
    "success",
    "results",
  );
}

export async function submitBatchResultsAction(
  formData: FormData,
): Promise<never> {
  const slug = readString(formData, "slug").trim();
  if (!slug) throw new AuthorizationError();
  const authorization = await requireCommissionerForLeague(slug);
  const gameIds = [...new Set(formData.getAll("gameId").filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  ))];

  const entries = gameIds.flatMap((gameId) => {
    const rawHome = readString(formData, `homeScore:${gameId}`).trim();
    const rawAway = readString(formData, `awayScore:${gameId}`).trim();
    if (!rawHome && !rawAway) return [];
    const homeScore = parseScore(rawHome);
    const awayScore = parseScore(rawAway);
    if (homeScore === null || awayScore === null) {
      redirectWithNotice(
        slug,
        "Every entered result needs two whole-number scores from 0 to 999.",
        "error",
        "scores",
      );
    }
    const expectedGameVersion = parseGameVersion(
      readString(formData, `expectedGameVersion:${gameId}`),
    );
    if (expectedGameVersion === null) throw new AuthorizationError();
    return [{ awayScore, expectedGameVersion, gameId, homeScore }];
  });

  if (!entries.length) {
    redirectWithNotice(slug, "Enter at least one final score.", "error", "scores");
  }

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        const activeLeague = await tx.league.findFirst({
          where: { archivedAt: null, id: authorization.leagueId },
          select: { id: true },
        });
        if (!activeLeague) throw new AuthorizationError();

        const games = await tx.game.findMany({
          where: {
            id: { in: entries.map((entry) => entry.gameId) },
            leagueId: authorization.leagueId,
          },
          select: { id: true, locked: true, version: true },
        });
        if (games.length !== entries.length) throw new AuthorizationError();
        if (
          games.some(
            (game) =>
              game.version !==
              entries.find((entry) => entry.gameId === game.id)?.expectedGameVersion,
          )
        ) {
          throw new Error("STALE_RESULT");
        }
        if (games.some((game) => game.locked)) {
          throw new Error("LOCKED_RESULT");
        }

        for (const entry of entries) {
          const changed = await tx.game.updateMany({
            where: {
              id: entry.gameId,
              leagueId: authorization.leagueId,
              locked: false,
              version: entry.expectedGameVersion,
            },
            data: { status: "COMPLETED", version: { increment: 1 } },
          });
          if (changed.count !== 1) throw new Error("STALE_RESULT");
          await tx.result.upsert({
            where: { gameId: entry.gameId },
            create: {
              awayScore: entry.awayScore,
              gameId: entry.gameId,
              homeScore: entry.homeScore,
            },
            update: {
              awayScore: entry.awayScore,
              homeScore: entry.homeScore,
              version: { increment: 1 },
            },
          });
        }
        await supersedePendingReports(
          tx,
          entries.map((entry) => entry.gameId),
          authorization.email,
        );
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: authorization.leagueId,
          summary: `Posted ${entries.length} final score${entries.length === 1 ? "" : "s"}.`,
          type: "BATCH_SCORES_POSTED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not save batch scores.", error);
    redirectWithNotice(
      slug,
      error instanceof Error && error.message === "LOCKED_RESULT"
        ? "One of those finals is locked. Unlock it before saving the batch."
        : error instanceof Error && error.message === "STALE_RESULT"
          ? "One of those games changed while this score sheet was open. No scores were changed; refresh and try again."
          : "No scores were changed. Review the entries and try again.",
      "error",
      "scores",
    );
  }

  revalidateLeagueViews(slug);
  redirectWithNotice(
    slug,
    `${entries.length} final ${entries.length === 1 ? "score" : "scores"} saved.`,
    "success",
    "scores",
  );
}

async function supersedePendingReports(
  tx: Prisma.TransactionClient,
  gameIds: string[],
  organizerEmail: string,
): Promise<void> {
  if (!gameIds.length) return;

  const reviewedAt = new Date();
  await tx.gameReport.updateMany({
    where: { gameId: { in: gameIds }, status: "PENDING" },
    data: {
      decisionNote: "Superseded by an organizer update to the official game.",
      pendingKey: null,
      reviewedAt,
      reviewedByEmail: organizerEmail,
      status: "REJECTED",
      version: { increment: 1 },
    },
  });
}

function parseScore(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const score = Number(value);
  return Number.isSafeInteger(score) && score >= 0 && score <= 999 ? score : null;
}

function parseGameVersion(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateLeagueViews(slug: string): void {
  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}

function redirectWithNotice(
  slug: string,
  notice: string,
  tone: "error" | "success",
  view?: "all" | "attention" | "requests" | "results" | "scores" | "settings" | "teams",
): never {
  const search = new URLSearchParams({ notice, tone });
  if (view) search.set("view", view);
  redirect(`/dashboard/${slug}?${search.toString()}`);
}
