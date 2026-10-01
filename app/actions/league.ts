"use server";

import { randomUUID } from "node:crypto";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertActiveOrganizerInTransaction,
  createSession,
  generateMagicLinkToken,
  getCurrentCommissionerSession,
  requireCommissionerForLeague,
  setSessionCookie,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmailConfiguration } from "@/lib/email";
import { recordLeagueActivity } from "@/lib/league-activity";
import {
  buildMagicLinkUrl,
  deliverMagicLink,
} from "@/lib/magic-link-delivery";
import { consumeRateLimit, getRequestFingerprint } from "@/lib/rate-limit";
import {
  parseScheduleFormFields,
  readScheduleFormFields,
  ScheduleFormValidationError,
  type ScheduleFormFields,
} from "@/lib/schedule-form";
import { generateScheduledRoundRobinSchedule } from "@/lib/schedule";

type CreateLeagueFormFields = ScheduleFormFields & {
  commissionerEmail: string;
  leagueName: string;
  sport: string;
  seasonLabel: string;
  teamNames: string;
  venueAddress: string;
  venueName: string;
};

type CreateLeagueFieldErrors = Partial<Record<keyof CreateLeagueFormFields, string>>;

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
  const { hasDuplicates, teamNames } = parseTeamNames(fields.teamNames);
  const fieldErrors = validateFields(
    fields.leagueName,
    teamNames,
    fields.commissionerEmail,
    hasDuplicates,
  );

  if (fields.sport.trim().length > 60) {
    fieldErrors.sport = "Keep the sport to 60 characters or fewer.";
  }
  if (fields.seasonLabel.trim().length > 60) {
    fieldErrors.seasonLabel = "Keep the season label to 60 characters or fewer.";
  }
  if (fields.venueName.trim().length > 80) {
    fieldErrors.venueName = "Keep the venue name to 80 characters or fewer.";
  }
  if (fields.venueAddress.trim().length > 180) {
    fieldErrors.venueAddress = "Keep the venue address to 180 characters or fewer.";
  }

  let scheduleSettings;

  try {
    scheduleSettings = parseScheduleFormFields(fields);
  } catch (error) {
    if (error instanceof ScheduleFormValidationError) {
      fieldErrors[error.field] = error.message;
    } else {
      throw error;
    }
  }

  if (Object.keys(fieldErrors).length || !scheduleSettings) {
    return {
      fields,
      fieldErrors,
      formError: null,
    };
  }

  const normalizedEmail = fields.commissionerEmail.trim().toLowerCase();
  const existingSession = await getCurrentCommissionerSession();
  if (existingSession?.scopeLeagueId) {
    return {
      fields,
      fieldErrors: {},
      formError:
        "Verify your current league email or sign out before creating another league.",
    };
  }
  if (existingSession && existingSession.email !== normalizedEmail) {
    return {
      fields,
      fieldErrors: {
        commissionerEmail: `Use ${existingSession.email}, the address for your signed-in session, or sign out first.`,
      },
      formError: null,
    };
  }
  const requestFingerprint = await getRequestFingerprint();
  const allowed = await consumeRateLimit("create-league", [
    { identifier: `ip:${requestFingerprint}`, limit: 5, windowMs: 60 * 60 * 1000 },
    { identifier: `email:${normalizedEmail}`, limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  ]);

  if (!allowed) {
    return {
      fields,
      fieldErrors: {},
      formError: "Too many leagues were created recently. Try again later.",
    };
  }

  let createdLeague: { id: string; slug: string } | null = null;

  try {
    const slug = await generateUniqueLeagueSlug(fields.leagueName);
    const schedule = generateScheduledRoundRobinSchedule(
      teamNames,
      1,
      scheduleSettings,
    );

    createdLeague = await db.$transaction(async (tx) => {
      const league = await tx.league.create({
        data: {
          commissionerEmail: normalizedEmail,
          name: fields.leagueName.trim(),
          fieldNames: scheduleSettings.fieldNames.join("\n"),
          gameDays: scheduleSettings.gameDays.join(","),
          gameTimes: scheduleSettings.gameTimes.join("\n"),
          gameDurationMinutes: scheduleSettings.gameDurationMinutes,
          scheduleStartDate: scheduleSettings.startDate,
          seasonLabel: fields.seasonLabel.trim() || null,
          slug,
          sport: fields.sport.trim() || null,
          timezone: scheduleSettings.timeZone,
          venueAddress: fields.venueAddress.trim() || null,
          venueName: fields.venueName.trim() || null,
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
            fieldName: matchup.fieldName,
            scheduledAt: matchup.scheduledAt,
          };
        }),
      });

      return league;
    });

    if (
      existingSession?.email !== normalizedEmail ||
      existingSession.scopeLeagueId !== null
    ) {
      const sessionToken = await createSession(normalizedEmail, createdLeague.id);
      await setSessionCookie(sessionToken);
    }

    redirect(`/dashboard/${createdLeague.slug}`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    console.error(error);

    if (createdLeague) {
      const recovery = new URLSearchParams({
        authError: "setup-session",
        slug: createdLeague.slug,
      });
      redirect(`/manage?${recovery.toString()}`);
    }

    return {
      fields,
      fieldErrors: {},
      formError: "We couldn't create this league right now. Please try again.",
    };
  }
}

export async function updateLeagueSettingsAction(
  formData: FormData,
): Promise<never> {
  const slug = readFormValue(formData, "slug").trim();
  if (!slug) redirect("/dashboard");
  const authorization = await requireCommissionerForLeague(slug);

  const name = readFormValue(formData, "name").trim();
  const sport = readFormValue(formData, "sport").trim();
  const seasonLabel = readFormValue(formData, "seasonLabel").trim();
  const venueName = readFormValue(formData, "venueName").trim();
  const venueAddress = readFormValue(formData, "venueAddress").trim();
  const venueUrl = readFormValue(formData, "venueUrl").trim();
  const winPoints = parsePoints(readFormValue(formData, "winPoints"));
  const tiePoints = parsePoints(readFormValue(formData, "tiePoints"));
  const lossPoints = parsePoints(readFormValue(formData, "lossPoints"));
  const showStandings = formData.get("showStandings") === "on";

  const error =
    !name
      ? "League name is required."
      : name.length > 80
        ? "Keep the league name under 80 characters."
        : sport.length > 60 || seasonLabel.length > 60
          ? "Keep sport and season labels under 60 characters."
          : venueName.length > 80 || venueAddress.length > 180
            ? "Keep the venue name under 80 characters and address under 180."
            : !isSafePublicUrl(venueUrl)
              ? "The venue link must start with http:// or https://."
              : winPoints === null || tiePoints === null || lossPoints === null
                ? "Scoring values must be whole numbers from 0 to 99."
                : null;
  if (error) redirectLeagueNotice(slug, error, "error", "settings");

  await db.$transaction(async (tx) => {
    await assertActiveOrganizerInTransaction(tx, authorization);
    await tx.league.update({
      where: { id: authorization.leagueId },
      data: {
        lossPoints: lossPoints!,
        name,
        seasonLabel: seasonLabel || null,
        showStandings,
        sport: sport || null,
        tiePoints: tiePoints!,
        venueAddress: venueAddress || null,
        venueName: venueName || null,
        venueUrl: venueUrl || null,
        version: { increment: 1 },
        winPoints: winPoints!,
      },
    });
    await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      leagueId: authorization.leagueId,
      summary: "Updated league details and public display settings.",
      type: "LEAGUE_SETTINGS_UPDATED",
    });
  });

  revalidateLeague(slug);
  redirectLeagueNotice(slug, "League settings saved.", "success", "settings");
}

export async function changeOrganizerEmailAction(
  formData: FormData,
): Promise<never> {
  const slug = readFormValue(formData, "slug").trim();
  const newEmail = readFormValue(formData, "organizerEmail").trim().toLowerCase();
  if (!slug) redirect("/dashboard");
  if (!isValidEmail(newEmail)) {
    redirectLeagueNotice(slug, "Enter a valid organizer email address.", "error", "settings");
  }

  const authorization = await requireCommissionerForLeague(slug);
  if (newEmail === authorization.email) {
    redirectLeagueNotice(slug, "That is already the organizer email.", "success", "settings");
  }

  if (process.env.NODE_ENV === "production") {
    try {
      getEmailConfiguration();
    } catch (error) {
      console.error("Organizer email change cannot be delivered.", error);
      redirectLeagueNotice(
        slug,
        "Email changes are temporarily unavailable. Try again later.",
        "error",
        "settings",
      );
    }
  }

  const requestFingerprint = await getRequestFingerprint();
  const allowed = await consumeRateLimit("organizer-email-change", [
    {
      identifier: `league:${authorization.leagueId}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    },
    { identifier: `email:${newEmail}`, limit: 3, windowMs: 60 * 60 * 1000 },
    {
      identifier: `ip:${requestFingerprint}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    },
  ]);
  if (!allowed) {
    redirectLeagueNotice(
      slug,
      "That email change was requested recently. Wait before trying again.",
      "error",
      "settings",
    );
  }

  const league = await db.league.findUnique({
    where: { id: authorization.leagueId },
    select: { commissionerEmail: true, name: true },
  });
  if (!league) redirect("/dashboard");

  if (authorization.scopeLeagueId === authorization.leagueId) {
    await db.$transaction(async (tx) => {
      await assertActiveOrganizerInTransaction(tx, authorization);
      await tx.league.update({
        where: { id: authorization.leagueId },
        data: { commissionerEmail: newEmail, version: { increment: 1 } },
      });
      await tx.commissionerSession.updateMany({
        where: {
          email: authorization.email,
          scopeLeagueId: authorization.leagueId,
        },
        data: { email: newEmail },
      });
      await tx.magicLinkToken.deleteMany({
        where: {
          leagueId: authorization.leagueId,
          usedAt: null,
          OR: [
            { purpose: "ORGANIZER_EMAIL_CHANGE" },
            { purpose: "SIGN_IN", teamId: null },
          ],
        },
      });
      await recordLeagueActivity(tx, {
        actorEmail: newEmail,
        actorRole: "ORGANIZER",
        leagueId: authorization.leagueId,
        summary: `Corrected the organizer email to ${newEmail}.`,
        touchesPublicPage: false,
        type: "ORGANIZER_EMAIL_CORRECTED",
      });
    });

    const token = await generateMagicLinkToken(newEmail, authorization.leagueId);
    const magicLinkUrl = await buildMagicLinkUrl(token);
    try {
      await deliverMagicLink({
        email: newEmail,
        leagueName: league.name,
        magicLinkUrl,
        roleLabel: "organizer",
      });
    } catch (error) {
      console.error("Could not deliver the corrected organizer link.", error);
      revalidateLeague(slug);
      redirectLeagueNotice(
        slug,
        "The organizer email was corrected, but the verification email could not be delivered. This browser still has access; check the email setup and try again.",
        "error",
        "settings",
      );
    }
    revalidateLeague(slug);
    redirectLeagueNotice(
      slug,
      "Organizer email corrected. A verification link was sent to the new address.",
      "success",
      "settings",
      magicLinkUrl,
    );
  }

  // A verified organizer keeps access until the replacement address confirms
  // the one-use ownership-transfer link.
  const token = await generateMagicLinkToken(newEmail, authorization.leagueId, {
    expectedCommissionerEmail: league.commissionerEmail,
    purpose: "ORGANIZER_EMAIL_CHANGE",
  });
  const magicLinkUrl = await buildMagicLinkUrl(token);
  try {
    await deliverMagicLink({
      email: newEmail,
      intent: "organizer-transfer",
      leagueName: league.name,
      magicLinkUrl,
      roleLabel: "organizer",
    });
  } catch (error) {
    console.error("Could not deliver the organizer-transfer link.", error);
    redirectLeagueNotice(
      slug,
      "The ownership transfer email could not be delivered. Check the email setup and try again; you still own the league.",
      "error",
      "settings",
    );
  }
  redirectLeagueNotice(
    slug,
    "Ownership transfer link sent. You keep access until the new address confirms it.",
    "success",
    "settings",
    magicLinkUrl,
  );
}

export async function toggleLeagueArchiveAction(
  formData: FormData,
): Promise<never> {
  const slug = readFormValue(formData, "slug").trim();
  const requestedState = readFormValue(formData, "archiveAction");
  if (!slug) redirect("/dashboard");
  if (requestedState !== "archive" && requestedState !== "reopen") {
    redirectLeagueNotice(
      slug,
      "Choose whether to archive or reopen the season.",
      "error",
      "settings",
    );
  }
  const authorization = await requireCommissionerForLeague(slug, {
    allowArchived: true,
  });

  const archived = await db.$transaction(async (tx) => {
    const league = await tx.league.findUnique({
      where: { id: authorization.leagueId },
      select: { archivedAt: true, commissionerEmail: true },
    });
    if (
      !league?.commissionerEmail ||
      league.commissionerEmail.trim().toLowerCase() !== authorization.email
    ) {
      redirect("/dashboard");
    }

    const wantsArchive = requestedState === "archive";
    const alreadyInRequestedState = wantsArchive
      ? league.archivedAt !== null
      : league.archivedAt === null;
    if (!alreadyInRequestedState) {
      await tx.league.update({
        where: { id: authorization.leagueId },
        data: {
          archivedAt: wantsArchive ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await recordLeagueActivity(tx, {
        actorEmail: authorization.email,
        actorRole: "ORGANIZER",
        leagueId: authorization.leagueId,
        summary: wantsArchive ? "Archived the season." : "Reopened the season.",
        type: wantsArchive ? "LEAGUE_ARCHIVED" : "LEAGUE_REOPENED",
      });
    }
    return wantsArchive;
  });

  revalidateLeague(slug);
  revalidatePath("/dashboard");
  redirectLeagueNotice(
    slug,
    archived
      ? "Season archived. Staff changes are paused; the public page stays available."
      : "Season reopened. Staff can make changes again.",
    "success",
    "settings",
  );
}

function readFormFields(formData: FormData): CreateLeagueFormFields {
  return {
    commissionerEmail: readFormValue(formData, "commissionerEmail"),
    leagueName: readFormValue(formData, "leagueName"),
    seasonLabel: readFormValue(formData, "seasonLabel"),
    sport: readFormValue(formData, "sport"),
    teamNames: readFormValue(formData, "teamNames"),
    venueAddress: readFormValue(formData, "venueAddress"),
    venueName: readFormValue(formData, "venueName"),
    ...readScheduleFormFields(formData),
  };
}

function readFormValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value : "";
}

function validateFields(
  leagueName: string,
  teamNames: string[],
  commissionerEmail: string,
  hasDuplicateTeams: boolean,
): CreateLeagueFieldErrors {
  const fieldErrors: CreateLeagueFieldErrors = {};

  if (!leagueName.trim()) {
    fieldErrors.leagueName = "League name is required.";
  } else if (leagueName.trim().length > 80) {
    fieldErrors.leagueName = "Keep the league name to 80 characters or fewer.";
  }

  if (hasDuplicateTeams) {
    fieldErrors.teamNames = "Each team name must be unique.";
  } else if (teamNames.length < 2) {
    fieldErrors.teamNames = "Add at least 2 unique team names.";
  } else if (teamNames.length > 20) {
    fieldErrors.teamNames = "This version supports up to 20 teams per league.";
  } else if (teamNames.some((name) => name.length > 60)) {
    fieldErrors.teamNames = "Keep each team name to 60 characters or fewer.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    !commissionerEmail.trim() ||
    commissionerEmail.trim().length > 254 ||
    !emailRegex.test(commissionerEmail.trim())
  ) {
    fieldErrors.commissionerEmail = "A valid email is required.";
  }

  return fieldErrors;
}

function parseTeamNames(rawTeamNames: string): {
  hasDuplicates: boolean;
  teamNames: string[];
} {
  const teamNames: string[] = [];
  const seen = new Set<string>();
  let hasDuplicates = false;

  for (const value of rawTeamNames.split(/[\n,]+/)) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      continue;
    }

    const normalizedValue = trimmedValue.toLowerCase();

    if (seen.has(normalizedValue)) {
      hasDuplicates = true;
      continue;
    }

    seen.add(normalizedValue);
    teamNames.push(trimmedValue);
  }

  return { hasDuplicates, teamNames };
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

function parsePoints(value: string): number | null {
  if (!/^\d{1,2}$/.test(value.trim())) return null;
  const points = Number(value);
  return Number.isSafeInteger(points) && points >= 0 && points <= 99
    ? points
    : null;
}

function isSafePublicUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function revalidateLeague(slug: string): void {
  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
}

function redirectLeagueNotice(
  slug: string,
  notice: string,
  tone: "error" | "success",
  view: "settings",
  developmentLink?: string | null,
): never {
  const search = new URLSearchParams({ notice, tone, view });
  if (process.env.NODE_ENV !== "production" && developmentLink) {
    search.set("devOrganizerLink", developmentLink);
  }
  redirect(`/dashboard/${slug}?${search.toString()}`);
}
