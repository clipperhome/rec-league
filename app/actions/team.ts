"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";

export async function addTeamAction(formData: FormData): Promise<void> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const teamName = (formData.get("teamName") as string | null)?.trim() ?? "";

  if (!slug || !teamName) return;

  const league = await db.league.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!league) throw new Error("League not found.");

  // Check for duplicate
  const existingTeams = await db.team.findMany({
    where: { leagueId: league.id },
    select: { name: true },
  });

  const isDuplicate = existingTeams.some(
    (t) => t.name.toLowerCase() === teamName.toLowerCase(),
  );

  if (isDuplicate) return;

  await db.team.create({
    data: {
      leagueId: league.id,
      name: teamName,
    },
  });

  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}

export async function removeTeamAction(formData: FormData): Promise<void> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const teamId = (formData.get("teamId") as string | null)?.trim() ?? "";

  if (!slug || !teamId) return;

  // Check if team has any games
  const gameCount = await db.game.count({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
  });

  if (gameCount > 0) {
    // Can't remove a team that has scheduled games — would break the schedule
    // In the future we could cascade-delete games or reschedule
    return;
  }

  await db.team.delete({
    where: { id: teamId },
  });

  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}
