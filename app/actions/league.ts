"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { generateRoundRobinSchedule } from "@/lib/schedule";

type CreateLeagueFormFields = {
  leagueName: string;
  sport: string;
  seasonLabel: string;
  teamNames: string;
};

type CreateLeagueFieldErrors = Partial<
  Record<"leagueName" | "teamNames", string>
>;

export type CreateLeagueActionState = {
  fields: CreateLeagueFormFields;
  fieldErrors: CreateLeagueFieldErrors;
  formError: string | null;
};

export async function createLeagueAction(
  _prevState: CreateLeagueActionState,
  formData: FormData,
): Promise<CreateLeagueActionState> {
  const fields = readFormFields(formData);
  const teamNames = parseTeamNames(fields.teamNames);
  const fieldErrors = validateFields(fields.leagueName, teamNames);

  if (fieldErrors.leagueName || fieldErrors.teamNames) {
    return {
      fields,
      fieldErrors,
      formError: null,
    };
  }

  try {
    const slug = await generateUniqueLeagueSlug(fields.leagueName);
    const schedule = generateRoundRobinSchedule(teamNames, 1);

    const createdLeague = await db.$transaction(async (tx) => {
      const league = await tx.league.create({
        data: {
          commissionerEmail: null,
          name: fields.leagueName.trim(),
          seasonLabel: fields.seasonLabel.trim() || null,
          slug,
          sport: fields.sport.trim() || null,
          teams: {
            create: teamNames.map((teamName) => ({
              name: teamName,
            })),
          },
        },
        select: {
          id: true,
          slug: true,
          teams: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const teamIdsByName = new Map(
        league.teams.map((team) => [team.name, team.id]),
      );

      await tx.game.createMany({
        data: schedule.map((matchup) => {
          const homeTeamId = teamIdsByName.get(matchup.home);
          const awayTeamId = teamIdsByName.get(matchup.away);

          if (!homeTeamId || !awayTeamId) {
            throw new Error("Generated matchup could not be mapped to a team.");
          }

          return {
            awayTeamId,
            homeTeamId,
            leagueId: league.id,
            round: matchup.round,
          };
        }),
      });

      return league;
    });

    redirect(`/l/${createdLeague.slug}`);
  } catch (error) {
    console.error(error);

    return {
      fields,
      fieldErrors: {},
      formError: "We couldn't create this league right now. Please try again.",
    };
  }
}

function readFormFields(formData: FormData): CreateLeagueFormFields {
  return {
    leagueName: readFormValue(formData, "leagueName"),
    seasonLabel: readFormValue(formData, "seasonLabel"),
    sport: readFormValue(formData, "sport"),
    teamNames: readFormValue(formData, "teamNames"),
  };
}

function readFormValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value : "";
}

function validateFields(
  leagueName: string,
  teamNames: string[],
): CreateLeagueFieldErrors {
  const fieldErrors: CreateLeagueFieldErrors = {};

  if (!leagueName.trim()) {
    fieldErrors.leagueName = "League name is required.";
  }

  if (teamNames.length < 2) {
    fieldErrors.teamNames = "Add at least 2 unique team names.";
  }

  return fieldErrors;
}

function parseTeamNames(rawTeamNames: string): string[] {
  const teamNames: string[] = [];
  const seen = new Set<string>();

  for (const value of rawTeamNames.split(/[\n,]+/)) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      continue;
    }

    const normalizedValue = trimmedValue.toLowerCase();

    if (seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    teamNames.push(trimmedValue);
  }

  return teamNames;
}

async function generateUniqueLeagueSlug(leagueName: string): Promise<string> {
  const baseSlug = slugify(leagueName);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${baseSlug}-${randomUUID().slice(0, 6)}`;
    const existingLeague = await db.league.findUnique({
      where: {
        slug: candidate,
      },
      select: {
        id: true,
      },
    });

    if (!existingLeague) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique league slug.");
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "league";
}
