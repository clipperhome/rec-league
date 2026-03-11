"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";

type GameWithLeagueSlug = {
  id: string;
  league: {
    slug: string;
  };
};

export async function submitResult(
  gameId: string,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  const game = await getGameWithLeagueSlug(gameId);

  // Check if game is locked
  const fullGame = await db.game.findUnique({
    where: { id: gameId },
    select: { locked: true },
  });

  if (fullGame?.locked) {
    throw new Error("Game is locked. Unlock it before editing the score.");
  }

  await db.$transaction(async (tx) => {
    await tx.result.upsert({
      where: {
        gameId,
      },
      create: {
        awayScore,
        gameId,
        homeScore,
      },
      update: {
        awayScore,
        homeScore,
      },
    });

    await tx.game.update({
      where: {
        id: gameId,
      },
      data: {
        status: "COMPLETED",
      },
    });
  });

  revalidateLeagueViews(game.league.slug);
}

export async function markRainout(gameId: string): Promise<void> {
  const game = await getGameWithLeagueSlug(gameId);

  await db.$transaction(async (tx) => {
    await tx.result.deleteMany({
      where: {
        gameId,
      },
    });

    await tx.game.update({
      where: {
        id: gameId,
      },
      data: {
        status: "RAINED_OUT",
      },
    });
  });

  revalidateLeagueViews(game.league.slug);
}

export async function rescheduleGame(
  gameId: string,
  scheduledAt: Date,
  round?: number,
): Promise<void> {
  const game = await getGameWithLeagueSlug(gameId);

  await db.$transaction(async (tx) => {
    await tx.result.deleteMany({
      where: {
        gameId,
      },
    });

    await tx.game.update({
      where: {
        id: gameId,
      },
      data: {
        status: "RESCHEDULED",
        scheduledAt,
        ...(round === undefined ? {} : { round }),
      },
    });
  });

  revalidateLeagueViews(game.league.slug);
}

export async function submitResultAction(formData: FormData): Promise<void> {
  const gameId = readString(formData, "gameId");
  const homeScore = parseRequiredNonNegativeInt(readString(formData, "homeScore"));
  const awayScore = parseRequiredNonNegativeInt(readString(formData, "awayScore"));

  if (!gameId) {
    return;
  }

  await submitResult(gameId, homeScore, awayScore);
}

export async function markRainoutAction(formData: FormData): Promise<void> {
  const gameId = readString(formData, "gameId");

  if (!gameId) {
    return;
  }

  await markRainout(gameId);
}

export async function rescheduleGameAction(formData: FormData): Promise<void> {
  const gameId = readString(formData, "gameId");
  const scheduledAtValue = readString(formData, "scheduledAt");
  const roundValue = readString(formData, "round");

  if (!gameId || !scheduledAtValue) {
    return;
  }

  const scheduledAt = new Date(scheduledAtValue);

  if (Number.isNaN(scheduledAt.getTime())) {
    return;
  }

  const parsedRound = roundValue.trim() ? parseRequiredNonNegativeInt(roundValue) : undefined;
  const round = parsedRound === undefined ? undefined : Math.max(1, parsedRound);

  await rescheduleGame(gameId, scheduledAt, round);
}

async function getGameWithLeagueSlug(gameId: string): Promise<GameWithLeagueSlug> {
  const game = await db.game.findUnique({
    where: {
      id: gameId,
    },
    select: {
      id: true,
      league: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!game) {
    throw new Error("Game not found.");
  }

  return game;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

function parseRequiredNonNegativeInt(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value "${value}"`);
  }

  return parsed;
}

function revalidateLeagueViews(slug: string): void {
  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}

export async function toggleLockAction(formData: FormData): Promise<void> {
  const gameId = readString(formData, "gameId");

  if (!gameId) return;

  const game = await db.game.findUnique({
    where: { id: gameId },
    select: { locked: true, league: { select: { slug: true } } },
  });

  if (!game) throw new Error("Game not found.");

  await db.game.update({
    where: { id: gameId },
    data: { locked: !game.locked },
  });

  revalidateLeagueViews(game.league.slug);
}
