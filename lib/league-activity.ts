import type { Prisma } from "@/app/generated/prisma/sqlite/client";

export async function recordLeagueActivity(
  tx: Prisma.TransactionClient,
  input: {
    actorEmail?: string | null;
    actorRole?: "IMPORT" | "MANAGER" | "ORGANIZER" | "SYSTEM" | "UNKNOWN";
    details?: Record<string, boolean | null | number | string> | null;
    gameId?: string | null;
    leagueId: string;
    operationId?: string | null;
    summary: string;
    teamId?: string | null;
    type: string;
    touchesPublicPage?: boolean;
  },
): Promise<number> {
  await tx.activityEvent.create({
    data: {
      actorEmail: input.actorEmail ?? null,
      actorRole: input.actorRole ?? "UNKNOWN",
      detailsJson: input.details ? JSON.stringify(input.details) : null,
      gameId: input.gameId ?? null,
      leagueId: input.leagueId,
      operationId: input.operationId ?? null,
      summary: input.summary,
      teamId: input.teamId ?? null,
      type: input.type,
    },
  });

  const now = new Date();
  const league = await tx.league.update({
    where: { id: input.leagueId },
    data: {
      dataRevision: { increment: 1 },
      ...(input.touchesPublicPage === false ? {} : { publicUpdatedAt: now }),
    },
    select: { dataRevision: true },
  });

  return league.dataRevision;
}
