"use server";

import { redirect } from "next/navigation";

import {
  AuthorizationError,
  clearSessionCookie,
  generateMagicLinkToken,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getEmailConfiguration,
} from "@/lib/email";
import {
  buildMagicLinkUrl,
  deliverMagicLink,
  queueMagicLinkDelivery,
} from "@/lib/magic-link-delivery";
import { consumeRateLimit, getRequestFingerprint } from "@/lib/rate-limit";

export type SendMagicLinkState = {
  email: string;
  error: string | null;
  magicLinkUrl: string | null;
  success: boolean;
};

export async function sendMagicLinkAction(
  _prevState: SendMagicLinkState,
  formData: FormData,
): Promise<SendMagicLinkState> {
  const email = readFormValue(formData, "email").trim();
  const normalizedEmail = email.toLowerCase();
  const slug = readFormValue(formData, "slug").trim();
  const requestedTeamId = readFormValue(formData, "teamId").trim();

  if (!isValidEmail(email)) {
    return failureState(email, "Enter a valid email address.");
  }

  // Validate production delivery before looking up an account. The response to
  // a service configuration problem therefore cannot reveal account existence.
  if (process.env.NODE_ENV === "production") {
    try {
      getEmailConfiguration();
    } catch (error) {
      console.error("Magic-link email is not configured.", error);
      return failureState(
        email,
        "We can't send login links right now. Please try again later.",
      );
    }
  }

  const requestFingerprint = await getRequestFingerprint();
  const rateLimitRules = [
    { identifier: `ip:${requestFingerprint}`, limit: 10, windowMs: 10 * 60 * 1000 },
    { identifier: `email:${normalizedEmail}`, limit: 3, windowMs: 10 * 60 * 1000 },
    ...(slug
      ? [{ identifier: `league:${slug}`, limit: 5, windowMs: 10 * 60 * 1000 }]
      : []),
  ];
  const allowed = await consumeRateLimit("magic-link", rateLimitRules);

  if (!allowed) return successState(email, null);

  const target = await findLoginTarget({
    email: normalizedEmail,
    slug,
    teamId: requestedTeamId,
  });

  // Keep the browser response identical for an unknown league, an unknown
  // email, and an email that does not own the requested league.
  if (
    !target
  ) {
    return successState(email, null);
  }

  try {
    const token = await generateMagicLinkToken(
      normalizedEmail,
      target.leagueId,
      { teamId: target.teamId },
    );
    const magicLinkUrl = await buildMagicLinkUrl(token);

    queueMagicLinkDelivery({
      email: normalizedEmail,
      leagueName: target.leagueName,
      magicLinkUrl,
    });

    return successState(
      email,
      process.env.NODE_ENV === "production" ? null : magicLinkUrl,
    );
  } catch (error) {
    console.error("Could not create a league staff magic link.", error);
    return failureState(
      email,
      "We couldn't send your login link. Please try again.",
    );
  }
}

async function findLoginTarget({
  email,
  slug,
  teamId,
}: {
  email: string;
  slug: string;
  teamId: string;
}): Promise<{
  leagueId: string;
  leagueName: string;
  teamId: string | null;
} | null> {
  if (teamId) {
    const team = await db.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        league: { select: { commissionerEmail: true, id: true, name: true } },
        managers: {
          where: { acceptedAt: { not: null }, email },
          select: { id: true, leagueId: true },
          take: 1,
        },
      },
    });

    if (!team) return null;
    if (team.league.commissionerEmail?.trim().toLowerCase() === email) {
      return {
        leagueId: team.league.id,
        leagueName: team.league.name,
        teamId: null,
      };
    }
    return team.managers.some((manager) => manager.leagueId === team.league.id)
      ? {
          leagueId: team.league.id,
          leagueName: team.league.name,
          teamId: team.id,
        }
      : null;
  }

  if (slug) {
    const league = await db.league.findUnique({
      where: { slug },
      select: {
        commissionerEmail: true,
        id: true,
        name: true,
        teamManagers: {
          where: { acceptedAt: { not: null }, email },
          orderBy: { updatedAt: "desc" },
          select: {
            leagueId: true,
            team: { select: { leagueId: true } },
            teamId: true,
          },
          take: 1,
        },
      },
    });

    if (!league) return null;
    if (league.commissionerEmail?.trim().toLowerCase() === email) {
      return { leagueId: league.id, leagueName: league.name, teamId: null };
    }
    const validManager = league.teamManagers.find(
      (manager) =>
        manager.leagueId === league.id && manager.team.leagueId === league.id,
    );
    return validManager
      ? {
          leagueId: league.id,
          leagueName: league.name,
          teamId: validManager.teamId,
        }
      : null;
  }

  const [organizedLeague, managedTeam] = await Promise.all([
    db.league.findFirst({
      where: { commissionerEmail: email },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    db.teamManager.findFirst({
      where: { acceptedAt: { not: null }, email },
      orderBy: { updatedAt: "desc" },
      select: {
        leagueId: true,
        team: { select: { leagueId: true } },
        teamId: true,
        league: { select: { id: true, name: true } },
      },
    }),
  ]);

  if (organizedLeague) {
    return {
      leagueId: organizedLeague.id,
      leagueName: organizedLeague.name,
      teamId: null,
    };
  }
  return managedTeam &&
    managedTeam.leagueId === managedTeam.league.id &&
    managedTeam.team.leagueId === managedTeam.league.id
    ? {
        leagueId: managedTeam.league.id,
        leagueName: managedTeam.league.name,
        teamId: managedTeam.teamId,
      }
    : null;
}

export async function logoutAction(): Promise<never> {
  await clearSessionCookie();
  redirect("/");
}

export async function sendVerificationLinkAction(
  formData: FormData,
): Promise<never> {
  const slug = readFormValue(formData, "slug").trim();
  if (!slug) throw new AuthorizationError();

  const authorization = await requireCommissionerForLeague(slug);

  if (process.env.NODE_ENV === "production") {
    try {
      getEmailConfiguration();
    } catch (error) {
      console.error("Magic-link email is not configured.", error);
      redirectToDashboard(
        slug,
        "We can’t send a verification link right now. Try again later.",
        "error",
      );
    }
  }

  const requestFingerprint = await getRequestFingerprint();
  const allowed = await consumeRateLimit("magic-link", [
    { identifier: `ip:${requestFingerprint}`, limit: 10, windowMs: 10 * 60 * 1000 },
    { identifier: `email:${authorization.email}`, limit: 3, windowMs: 10 * 60 * 1000 },
    { identifier: `league:${slug}`, limit: 5, windowMs: 10 * 60 * 1000 },
  ]);

  if (!allowed) {
    redirectToDashboard(
      slug,
      "A verification link was requested recently. Check your inbox before trying again.",
      "success",
    );
  }

  const league = await db.league.findUnique({
    where: { id: authorization.leagueId },
    select: { name: true },
  });
  if (!league) throw new AuthorizationError();

  let localVerificationUrl: string | null = null;
  try {
    const token = await generateMagicLinkToken(
      authorization.email,
      authorization.leagueId,
    );
    const magicLinkUrl = await buildMagicLinkUrl(token);
    if (process.env.NODE_ENV !== "production") {
      localVerificationUrl = magicLinkUrl;
    }

    await deliverMagicLink({
      email: authorization.email,
      leagueName: league.name,
      magicLinkUrl,
    });
  } catch (error) {
    console.error("Could not create or deliver a verification link.", error);
    redirectToDashboard(
      slug,
      "We couldn’t create a verification link. Try again.",
      "error",
    );
  }

  redirectToDashboard(
    slug,
    process.env.NODE_ENV === "production"
      ? "Verification link sent. Open it from your email to secure returning access."
      : "Development verification link created. Open the test link below.",
    "success",
    localVerificationUrl,
  );
}

function readFormValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function successState(
  email: string,
  magicLinkUrl: string | null,
): SendMagicLinkState {
  return { email, error: null, magicLinkUrl, success: true };
}

function failureState(email: string, error: string): SendMagicLinkState {
  return { email, error, magicLinkUrl: null, success: false };
}

function redirectToDashboard(
  slug: string,
  notice: string,
  tone: "error" | "success",
  devVerify?: string | null,
): never {
  const search = new URLSearchParams({ notice, tone });
  if (process.env.NODE_ENV !== "production" && devVerify) {
    search.set("devVerify", devVerify);
  }
  redirect(`/dashboard/${slug}?${search.toString()}`);
}
