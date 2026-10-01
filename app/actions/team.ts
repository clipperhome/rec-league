"use server";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertActiveOrganizerInTransaction,
  AuthorizationError,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { recordLeagueActivity } from "@/lib/league-activity";
import { parseScheduleFormFields } from "@/lib/schedule-form";
import { assignSchedule, generateRoundRobinSchedule } from "@/lib/schedule";

const MIN_TEAMS = 2;
const MAX_TEAMS = 20;

export async function addTeamAction(formData: FormData): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const teamName = readString(formData, "teamName").trim();

  if (!slug) throw new AuthorizationError();
  if (!teamName) redirectWithNotice(slug, "Enter a team name.", "error");
  if (teamName.length > 60) {
    redirectWithNotice(slug, "Keep the team name to 60 characters or fewer.", "error");
  }

  const authorization = await requireCommissionerForLeague(slug);

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        const league = await getLeagueForTeamChange(tx, authorization.leagueId);

        if (!league) throw new AuthorizationError();
        assertTeamChangesOpen(league.games);
        if (league.teams.length >= MAX_TEAMS) {
          throw new TeamChangeError(`A league can have up to ${MAX_TEAMS} teams.`);
        }
        if (
          league.teams.some(
            (team) => team.name.toLowerCase() === teamName.toLowerCase(),
          )
        ) {
          throw new TeamChangeError(`${teamName} is already in this league.`);
        }

        const addedTeam = await tx.team.create({
          data: { leagueId: league.id, name: teamName },
          select: { id: true, name: true },
        });

        await reconcileSchedule(tx, league, [...league.teams, addedTeam]);
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: league.id,
          summary: `Added ${teamName}.`,
          teamId: addedTeam.id,
          type: "TEAM_ADDED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    handleTeamChangeError(slug, error);
  }

  refreshLeaguePages(slug);
  redirectWithNotice(
    slug,
    `${teamName} was added. Existing game details were preserved and new matchups were scheduled.`,
    "success",
  );
}

export async function removeTeamAction(formData: FormData): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const teamId = readString(formData, "teamId").trim();

  if (!slug || !teamId) throw new AuthorizationError();

  const authorization = await requireCommissionerForLeague(slug);
  let removedTeamName = "Team";

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        const league = await getLeagueForTeamChange(tx, authorization.leagueId);

        if (!league) throw new AuthorizationError();
        assertTeamChangesOpen(league.games);
        if (league.teams.length <= MIN_TEAMS) {
          throw new TeamChangeError("A league needs at least two teams.");
        }

        const removedTeam = league.teams.find((team) => team.id === teamId);
        if (!removedTeam) throw new AuthorizationError();
        removedTeamName = removedTeam.name;

        await tx.game.deleteMany({
          where: {
            leagueId: league.id,
            OR: [{ awayTeamId: teamId }, { homeTeamId: teamId }],
          },
        });
        await tx.team.delete({ where: { id: teamId } });

        const remainingTeams = league.teams.filter((team) => team.id !== teamId);
        const remainingGames = league.games.filter(
          (game) => game.awayTeamId !== teamId && game.homeTeamId !== teamId,
        );
        await reconcileSchedule(
          tx,
          { ...league, games: remainingGames },
          remainingTeams,
        );
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: league.id,
          summary: `Removed ${removedTeamName} and its games.`,
          type: "TEAM_REMOVED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    handleTeamChangeError(slug, error);
  }

  refreshLeaguePages(slug);
  redirectWithNotice(
    slug,
    `${removedTeamName} and its games were removed. Other game details were preserved.`,
    "success",
  );
}

export async function renameTeamAction(formData: FormData): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const teamId = readString(formData, "teamId").trim();
  const teamName = readString(formData, "teamName").trim();
  if (!slug || !teamId) throw new AuthorizationError();
  if (!teamName || teamName.length > 60) {
    redirectWithNotice(
      slug,
      "Enter a team name of 60 characters or fewer.",
      "error",
    );
  }

  const authorization = await requireCommissionerForLeague(slug);
  let oldName = "Team";

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        const team = await tx.team.findFirst({
          where: { id: teamId, leagueId: authorization.leagueId },
          select: { name: true },
        });
        if (!team) throw new AuthorizationError();
        oldName = team.name;

        const otherTeams = await tx.team.findMany({
          where: {
            id: { not: teamId },
            leagueId: authorization.leagueId,
          },
          select: { name: true },
        });
        if (
          otherTeams.some(
            (candidate) =>
              candidate.name.trim().toLowerCase() === teamName.toLowerCase(),
          )
        ) {
          throw new TeamChangeError(`${teamName} is already in this league.`);
        }

        await tx.team.update({
          where: { id: teamId },
          data: { name: teamName, version: { increment: 1 } },
        });
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: authorization.leagueId,
          summary: `Renamed ${oldName} to ${teamName}.`,
          teamId,
          type: "TEAM_RENAMED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    handleTeamChangeError(slug, error);
  }

  refreshLeaguePages(slug);
  revalidatePath(`/team/${teamId}`);
  redirectWithNotice(slug, `${oldName} is now ${teamName}.`, "success");
}

async function getLeagueForTeamChange(
  tx: Prisma.TransactionClient,
  leagueId: string,
) {
  return tx.league.findUnique({
    where: { id: leagueId },
    select: {
      fieldNames: true,
      gameDays: true,
      gameDurationMinutes: true,
      gameTimes: true,
      games: {
        orderBy: [{ round: "asc" }, { id: "asc" }],
        select: {
          awayTeamId: true,
          fieldName: true,
          homeTeamId: true,
          id: true,
          round: true,
          result: { select: { id: true } },
          scheduledAt: true,
          status: true,
        },
      },
      id: true,
      scheduleStartDate: true,
      teams: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      },
      timezone: true,
    },
  });
}

type TeamChangeLeague = NonNullable<
  Awaited<ReturnType<typeof getLeagueForTeamChange>>
>;
type TeamChangeGame = TeamChangeLeague["games"][number];
type TeamChangeTeam = TeamChangeLeague["teams"][number];

async function reconcileSchedule(
  tx: Prisma.TransactionClient,
  league: TeamChangeLeague,
  teams: TeamChangeTeam[],
): Promise<void> {
  const teamIdsByName = new Map(teams.map((team) => [team.name, team.id]));
  const teamNamesById = new Map(teams.map((team) => [team.id, team.name]));
  const existingByPair = new Map<string, TeamChangeGame[]>();

  for (const game of league.games) {
    const key = pairKey(game.homeTeamId, game.awayTeamId);
    existingByPair.set(key, [...(existingByPair.get(key) ?? []), game]);
  }

  const desired = generateRoundRobinSchedule(
    teams.map((team) => team.name),
    1,
  ).map((matchup) => {
    const homeTeamId = teamIdsByName.get(matchup.home);
    const awayTeamId = teamIdsByName.get(matchup.away);

    if (!homeTeamId || !awayTeamId) {
      throw new Error("Generated matchup could not be mapped to a team.");
    }

    const key = pairKey(homeTeamId, awayTeamId);
    const existing = existingByPair.get(key)?.shift();
    return { ...matchup, awayTeamId, existing, homeTeamId };
  });

  const keptGameIds = new Set(
    desired.flatMap((entry) => (entry.existing ? [entry.existing.id] : [])),
  );
  const obsoleteGameIds = league.games
    .filter((game) => !keptGameIds.has(game.id))
    .map((game) => game.id);

  if (obsoleteGameIds.length) {
    await tx.game.deleteMany({ where: { id: { in: obsoleteGameIds } } });
  }

  // Round numbers are internal schedule buckets and must follow the newly
  // generated pairing set so added matchups do not collide with preserved
  // teams. Keep the existing game's home/away assignment and every visible
  // game detail intact.
  for (const entry of desired) {
    if (!entry.existing || entry.existing.round === entry.round) continue;

    await tx.game.update({
      where: { id: entry.existing.id },
      data: { round: entry.round, version: { increment: 1 } },
    });
  }

  const newGames = desired.filter((entry) => !entry.existing);
  if (!newGames.length) return;

  const settings = getStoredScheduleSettings(league);
  const assigned = settings
    ? assignSchedule(
        newGames.map(({ away, home, round }) => ({ away, home, round })),
        settings,
        {
          occupiedGames: desired.flatMap((entry) =>
            entry.existing?.scheduledAt && entry.existing.status !== "RAINED_OUT"
              ? occupiedGameFor(entry.existing, entry.round, teamNamesById)
              : [],
          ),
        },
      )
    : newGames.map(({ away, home, round }) => ({
        away,
        fieldName: null,
        home,
        round,
        scheduledAt: null,
      }));

  await tx.game.createMany({
    data: newGames.map((entry, index) => ({
      awayTeamId: entry.awayTeamId,
      fieldName: assigned[index].fieldName,
      homeTeamId: entry.homeTeamId,
      leagueId: league.id,
      round: entry.round,
      scheduledAt: assigned[index].scheduledAt,
    })),
  });
}

function occupiedGameFor(
  game: TeamChangeGame,
  round: number,
  teamNamesById: Map<string, string>,
) {
  const away = teamNamesById.get(game.awayTeamId);
  const home = teamNamesById.get(game.homeTeamId);

  if (!away || !home || !game.scheduledAt) {
    throw new Error("Existing game could not be mapped to its teams.");
  }

  return [
    {
      away,
      fieldName: game.fieldName,
      home,
      round,
      scheduledAt: game.scheduledAt,
    },
  ];
}

function getStoredScheduleSettings(league: TeamChangeLeague) {
  if (
    !league.scheduleStartDate ||
    !league.gameDays ||
    !league.gameTimes ||
    !league.fieldNames
  ) {
    return null;
  }

  try {
    return parseScheduleFormFields({
      fieldNames: league.fieldNames,
      gameDurationMinutes: String(league.gameDurationMinutes),
      gameDays: league.gameDays.split(","),
      gameTimes: league.gameTimes,
      startDate: league.scheduleStartDate,
      timezone: league.timezone,
    });
  } catch {
    return null;
  }
}

function assertTeamChangesOpen(games: TeamChangeGame[]): void {
  if (games.some((game) => game.result || game.status === "COMPLETED")) {
    throw new TeamChangeError(
      "Teams can’t be changed after a final score is posted.",
    );
  }
}

function pairKey(firstTeamId: string, secondTeamId: string): string {
  return [firstTeamId, secondTeamId].sort().join(":");
}

class TeamChangeError extends Error {}

function handleTeamChangeError(slug: string, error: unknown): never {
  if (error instanceof AuthorizationError) throw error;
  if (error instanceof TeamChangeError) {
    redirectWithNotice(slug, error.message, "error");
  }

  console.error("Could not change league teams.", error);
  redirectWithNotice(
    slug,
    "The team change could not be saved. Refresh and try again.",
    "error",
  );
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function refreshLeaguePages(slug: string): void {
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}

function redirectWithNotice(
  slug: string,
  notice: string,
  tone: "error" | "success",
): never {
  const search = new URLSearchParams({ notice, tone });
  search.set("view", "teams");
  redirect(`/dashboard/${slug}?${search.toString()}`);
}
