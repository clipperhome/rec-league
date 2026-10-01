import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";

import { db } from "./db";
import { recordLeagueActivity } from "./league-activity";

const SESSION_COOKIE_NAME = "commissioner_session";
const MAGIC_LINK_EXPIRY_MINUTES = 15;
const SESSION_EXPIRY_DAYS = 30;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export type CommissionerSession = {
  email: string;
  /** A setup session can manage only its newly-created league until email verification. */
  scopeLeagueId: string | null;
};

export type CommissionerLeagueAuthorization = CommissionerSession & {
  leagueId: string;
  slug: string;
};

export type CommissionerGameAuthorization =
  CommissionerLeagueAuthorization & {
    gameId: string;
  };

export type TeamManagerAuthorization = CommissionerSession & {
  archivedAt: Date | null;
  isCommissioner: boolean;
  leagueId: string;
  slug: string;
  teamId: string;
  teamName: string;
};

export type MagicLinkPurpose =
  | "SIGN_IN"
  | "TEAM_MANAGER_INVITE"
  | "ORGANIZER_EMAIL_CHANGE";

/**
 * A deliberately generic error: callers should not reveal whether a league or
 * game exists when the current commissioner is not allowed to manage it.
 */
export class AuthorizationError extends Error {
  constructor() {
    super("You are not authorized to manage this league.");
    this.name = "AuthorizationError";
  }
}

export async function assertActiveOrganizerInTransaction(
  tx: Prisma.TransactionClient,
  authorization: {
    email: string;
    leagueId: string;
    scopeLeagueId?: string | null;
  },
): Promise<void> {
  return assertOrganizerInTransaction(tx, authorization);
}

export async function assertOrganizerInTransaction(
  tx: Prisma.TransactionClient,
  authorization: {
    email: string;
    leagueId: string;
    scopeLeagueId?: string | null;
  },
  options: { allowArchived?: boolean; requireVerified?: boolean } = {},
): Promise<void> {
  const league = await tx.league.findUnique({
    where: { id: authorization.leagueId },
    select: { archivedAt: true, commissionerEmail: true },
  });

  if (
    !league?.commissionerEmail ||
    (league.archivedAt && options.allowArchived !== true) ||
    normalizeEmail(league.commissionerEmail) !== authorization.email ||
    (options.requireVerified === true && authorization.scopeLeagueId !== null)
  ) {
    throw new AuthorizationError();
  }
}

export async function assertTeamAccessInTransaction(
  tx: Prisma.TransactionClient,
  authorization: {
    email: string;
    isCommissioner: boolean;
    leagueId: string;
    scopeLeagueId?: string | null;
    teamId: string;
  },
  options: { allowArchived?: boolean; allowOrganizer?: boolean } = {},
): Promise<void> {
  const team = await tx.team.findFirst({
    where: { id: authorization.teamId, leagueId: authorization.leagueId },
    select: {
      league: {
        select: { archivedAt: true, commissionerEmail: true },
      },
      managers: {
        where: {
          acceptedAt: { not: null },
          email: authorization.email,
          leagueId: authorization.leagueId,
        },
        select: { id: true },
        take: 1,
      },
    },
  });
  const organizerMatches =
    authorization.isCommissioner &&
    options.allowOrganizer === true &&
    normalizeEmail(team?.league.commissionerEmail ?? "") === authorization.email;
  const managerMatches =
    authorization.scopeLeagueId === null && team?.managers.length === 1;
  if (
    !team ||
    (!organizerMatches && !managerMatches) ||
    (team.league.archivedAt && options.allowArchived !== true)
  ) {
    throw new AuthorizationError();
  }
}

export async function generateMagicLinkToken(
  email: string,
  leagueId: string,
  options: {
    expectedCommissionerEmail?: string | null;
    purpose?: MagicLinkPurpose;
    teamId?: string | null;
  } = {},
): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const purpose = options.purpose ?? "SIGN_IN";
  const teamId = options.teamId ?? null;
  const expectedCommissionerEmail = options.expectedCommissionerEmail ?? null;
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
  );

  await db.$transaction(async (tx) => {
    if (purpose === "ORGANIZER_EMAIL_CHANGE") {
      if (!expectedCommissionerEmail) throw new AuthorizationError();
      const currentOwner = await tx.league.findFirst({
        where: {
          archivedAt: null,
          commissionerEmail: expectedCommissionerEmail,
          id: leagueId,
        },
        select: { id: true },
      });
      if (!currentOwner) throw new AuthorizationError();
    }
    await tx.magicLinkToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await tx.magicLinkToken.deleteMany({
      where:
        purpose === "ORGANIZER_EMAIL_CHANGE"
          ? { leagueId, purpose, usedAt: null }
          : {
              email: normalizedEmail,
              leagueId,
              purpose,
              teamId,
              usedAt: null,
            },
    });
    await tx.magicLinkToken.create({
      data: {
        token: hashToken(token),
        email: normalizedEmail,
        expectedCommissionerEmail,
        leagueId,
        teamId,
        purpose,
        expiresAt,
      },
    });
  });

  return token;
}

export async function getMagicLinkContext(token: string): Promise<{
  leagueName: string;
  purpose: MagicLinkPurpose;
  teamName: string | null;
} | null> {
  if (!isValidToken(token)) return null;

  const record = await db.magicLinkToken.findFirst({
    where: {
      expiresAt: { gt: new Date() },
      token: { in: tokenStorageCandidates(token) },
      usedAt: null,
    },
    select: {
      league: { select: { name: true } },
      expectedCommissionerEmail: true,
      leagueId: true,
      purpose: true,
      teamId: true,
    },
  });
  if (!record) return null;

  if (record.purpose === "ORGANIZER_EMAIL_CHANGE") {
    if (!record.expectedCommissionerEmail) return null;
    const currentOwner = await db.league.findFirst({
      where: {
        archivedAt: null,
        commissionerEmail: record.expectedCommissionerEmail,
        id: record.leagueId,
      },
      select: { id: true },
    });
    if (!currentOwner) return null;
  }

  let teamName: string | null = null;
  if (record.teamId) {
    const team = await db.team.findFirst({
      where: { id: record.teamId, leagueId: record.leagueId },
      select: { name: true },
    });
    if (!team) return null;
    teamName = team.name;
  }

  return {
    leagueName: record.league.name,
    purpose: record.purpose as MagicLinkPurpose,
    teamName,
  };
}

export async function verifyMagicLinkToken(
  token: string,
): Promise<{
  email: string;
  leagueId: string;
  sessionToken: string;
  slug: string;
  teamId: string | null;
  purpose: MagicLinkPurpose;
} | null> {
  if (!isValidToken(token)) return null;

  const session = newSessionValues();

  return db.$transaction(async (tx) => {
    const now = new Date();
    const record = await tx.magicLinkToken.findFirst({
      where: {
        token: { in: tokenStorageCandidates(token) },
        usedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        league: {
          select: { archivedAt: true, commissionerEmail: true, slug: true },
        },
      },
    });

    if (!record) return null;

    const email = normalizeEmail(record.email);
    const purpose = record.purpose as MagicLinkPurpose;
    let teamManagerAssignmentId: string | null = null;

    if (purpose === "TEAM_MANAGER_INVITE" || record.teamId) {
      if (!record.teamId) return null;
      const assignment = await tx.teamManager.findFirst({
        where: {
          email,
          leagueId: record.leagueId,
          teamId: record.teamId,
        },
        select: {
          id: true,
          team: { select: { leagueId: true } },
        },
      });
      if (!assignment || assignment.team.leagueId !== record.leagueId) return null;
      teamManagerAssignmentId = assignment.id;

      if (purpose === "TEAM_MANAGER_INVITE") {
        // An invitation is an offer of new access. Once the organizer archives
        // the season, old unaccepted offers should not be able to create it.
        if (record.league.archivedAt) return null;
      } else {
        const accepted = await tx.teamManager.findFirst({
          where: { id: assignment.id, acceptedAt: { not: null } },
          select: { id: true },
        });
        if (!accepted) return null;
      }
    } else if (purpose === "ORGANIZER_EMAIL_CHANGE") {
      if (
        record.league.archivedAt ||
        !record.expectedCommissionerEmail ||
        normalizeEmail(record.league.commissionerEmail ?? "") !==
          normalizeEmail(record.expectedCommissionerEmail)
      ) {
        return null;
      }
    } else {
      if (
        !record.league.commissionerEmail ||
        normalizeEmail(record.league.commissionerEmail) !== email
      ) {
        return null;
      }
    }

    // Claim the token atomically so two simultaneous requests cannot both
    // create a session from the same magic link.
    const claimed = await tx.magicLinkToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) return null;

    // Role-changing writes happen only after this exact one-use token has been
    // claimed. A link deleted by a resend or revocation can never mutate access.
    if (purpose === "TEAM_MANAGER_INVITE" && teamManagerAssignmentId) {
      await tx.teamManager.update({
        where: { id: teamManagerAssignmentId },
        data: { acceptedAt: now, version: { increment: 1 } },
      });
      await recordLeagueActivity(tx, {
        actorEmail: email,
        actorRole: "MANAGER",
        leagueId: record.leagueId,
        summary: "Accepted a team-manager invitation.",
        teamId: record.teamId,
        touchesPublicPage: false,
        type: "MANAGER_INVITE_ACCEPTED",
      });
    } else if (purpose === "ORGANIZER_EMAIL_CHANGE") {
      const changedOwner = await tx.league.updateMany({
        where: {
          archivedAt: null,
          commissionerEmail: record.expectedCommissionerEmail!,
          id: record.leagueId,
        },
        data: { commissionerEmail: email, version: { increment: 1 } },
      });
      if (changedOwner.count !== 1) return null;
      await recordLeagueActivity(tx, {
        actorEmail: email,
        actorRole: "ORGANIZER",
        leagueId: record.leagueId,
        summary: `Transferred organizer ownership to ${email}.`,
        touchesPublicPage: false,
        type: "ORGANIZER_OWNERSHIP_TRANSFERRED",
      });
    }

    // The one-use claim, any access change, and the verified session are a
    // single unit. A transient database failure can no longer consume an invite
    // or transfer ownership without also giving the recipient a usable session.
    await tx.commissionerSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const revokeBootstrap =
      (purpose === "SIGN_IN" && record.teamId === null) ||
      purpose === "ORGANIZER_EMAIL_CHANGE";
    if (revokeBootstrap) {
      await tx.commissionerSession.deleteMany({
        where: { scopeLeagueId: record.leagueId },
      });
    }
    await tx.commissionerSession.create({
      data: {
        email,
        expiresAt: session.expiresAt,
        scopeLeagueId: null,
        token: session.storedToken,
      },
    });

    return {
      email,
      leagueId: record.leagueId,
      sessionToken: session.rawToken,
      slug: record.league.slug,
      teamId: record.teamId,
      purpose,
    };
  });
}

export async function createSession(
  email: string,
  scopeLeagueId: string | null = null,
): Promise<string> {
  const { expiresAt, rawToken, storedToken } = newSessionValues();

  await db.$transaction(async (tx) => {
    await tx.commissionerSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await tx.commissionerSession.create({
      data: {
        token: storedToken,
        email: normalizeEmail(email),
        scopeLeagueId,
        expiresAt,
      },
    });
  });

  return rawToken;
}

/**
 * Promote a magic-link login to full email-verified access. Any bootstrap
 * session for this league is revoked so a person who merely typed someone
 * else's address during setup cannot retain access after the owner signs in.
 */
export async function createVerifiedSession(
  email: string,
  verifiedLeagueId: string,
  options: { revokeBootstrap?: boolean } = {},
): Promise<string> {
  const { expiresAt, rawToken, storedToken } = newSessionValues();

  await db.$transaction(async (tx) => {
    await tx.commissionerSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (options.revokeBootstrap !== false) {
      await tx.commissionerSession.deleteMany({
        where: { scopeLeagueId: verifiedLeagueId },
      });
    }
    await tx.commissionerSession.create({
      data: {
        email: normalizeEmail(email),
        expiresAt,
        scopeLeagueId: null,
        token: storedToken,
      },
    });
  });

  return rawToken;
}

export async function setSessionCookie(sessionToken: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
  });
}

/** Return the signed-in commissioner without authorizing a specific league. */
export async function getCurrentCommissionerSession(): Promise<CommissionerSession | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken || !isValidToken(sessionToken)) return null;

  // The raw-token candidate supports sessions created by the original local
  // prototype. Newly-created sessions are always stored as SHA-256 hashes.
  const session = await db.commissionerSession.findFirst({
    where: {
      token: { in: tokenStorageCandidates(sessionToken) },
      expiresAt: { gt: new Date() },
    },
    select: { id: true, token: true, email: true, scopeLeagueId: true },
  });

  if (!session) return null;

  // Upgrade a still-valid prototype session after its first successful use.
  if (session.token === sessionToken) {
    await db.commissionerSession.updateMany({
      where: { id: session.id, token: sessionToken },
      data: { token: hashToken(sessionToken) },
    });
  }

  return {
    email: normalizeEmail(session.email),
    scopeLeagueId: session.scopeLeagueId,
  };
}

export async function getCommissionerSession(
  slug: string,
): Promise<CommissionerSession | null> {
  const session = await getCurrentCommissionerSession();

  if (!session) return null;

  const league = await db.league.findUnique({
    where: { slug },
    select: { id: true, commissionerEmail: true },
  });

  if (!league?.commissionerEmail) return null;
  if (normalizeEmail(league.commissionerEmail) !== session.email) return null;
  if (session.scopeLeagueId && session.scopeLeagueId !== league.id) return null;

  return session;
}

/**
 * Authorize a commissioner mutation against a league. This must be called by
 * the mutation itself; protecting only the dashboard page is not sufficient.
 */
export async function requireCommissionerForLeague(
  slug: string,
  options: { allowArchived?: boolean; requireVerified?: boolean } = {},
): Promise<CommissionerLeagueAuthorization> {
  const session = await getCurrentCommissionerSession();

  if (!session) throw new AuthorizationError();

  const league = await db.league.findUnique({
    where: { slug },
    select: { archivedAt: true, id: true, slug: true, commissionerEmail: true },
  });

  if (
    !league?.commissionerEmail ||
    normalizeEmail(league.commissionerEmail) !== session.email ||
    (session.scopeLeagueId !== null && session.scopeLeagueId !== league.id) ||
    (options.requireVerified === true && session.scopeLeagueId !== null) ||
    (league.archivedAt !== null && options.allowArchived !== true)
  ) {
    throw new AuthorizationError();
  }

  return {
    email: session.email,
    leagueId: league.id,
    scopeLeagueId: session.scopeLeagueId,
    slug: league.slug,
  };
}

/**
 * Authorize a commissioner mutation against the league that owns a game.
 * expectedSlug prevents a valid game ID from being submitted through another
 * league's dashboard route.
 */
export async function requireCommissionerForGame(
  gameId: string,
  expectedSlug?: string,
): Promise<CommissionerGameAuthorization> {
  const session = await getCurrentCommissionerSession();

  if (!session) throw new AuthorizationError();

  const game = await db.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      league: {
        select: {
          archivedAt: true,
          id: true,
          slug: true,
          commissionerEmail: true,
        },
      },
    },
  });

  if (
    !game?.league.commissionerEmail ||
    normalizeEmail(game.league.commissionerEmail) !== session.email ||
    (session.scopeLeagueId !== null &&
      session.scopeLeagueId !== game.league.id) ||
    (expectedSlug !== undefined && game.league.slug !== expectedSlug) ||
    game.league.archivedAt !== null
  ) {
    throw new AuthorizationError();
  }

  return {
    email: session.email,
    gameId: game.id,
    leagueId: game.league.id,
    scopeLeagueId: session.scopeLeagueId,
    slug: game.league.slug,
  };
}

/**
 * Authorize the current identity for one team's private operating desk. A
 * commissioner may open any team in their league. Team-manager access always
 * requires an email-verified (unscoped) session.
 */
export async function getTeamManagerAuthorization(
  teamId: string,
  options: { allowArchived?: boolean } = {},
): Promise<TeamManagerAuthorization | null> {
  const session = await getCurrentCommissionerSession();

  if (!session) return null;

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      league: {
        select: {
          archivedAt: true,
          commissionerEmail: true,
          id: true,
          slug: true,
        },
      },
      managers: {
        where: { acceptedAt: { not: null }, email: session.email },
        select: { id: true, leagueId: true },
        take: 1,
      },
    },
  });

  if (!team?.league.commissionerEmail) return null;

  const isCommissioner =
    normalizeEmail(team.league.commissionerEmail) === session.email;
  const isVerifiedManager =
    session.scopeLeagueId === null &&
    team.managers.some((manager) => manager.leagueId === team.league.id);

  if (
    (!isCommissioner && !isVerifiedManager) ||
    (session.scopeLeagueId !== null &&
      session.scopeLeagueId !== team.league.id) ||
    (team.league.archivedAt !== null && options.allowArchived !== true)
  ) {
    return null;
  }

  return {
    archivedAt: team.league.archivedAt,
    email: session.email,
    isCommissioner,
    leagueId: team.league.id,
    scopeLeagueId: session.scopeLeagueId,
    slug: team.league.slug,
    teamId: team.id,
    teamName: team.name,
  };
}

export async function requireTeamManagerForGame(
  teamId: string,
  gameId: string,
): Promise<TeamManagerAuthorization & { gameId: string }> {
  const authorization = await getTeamManagerAuthorization(teamId);

  if (!authorization) throw new AuthorizationError();

  const game = await db.game.findFirst({
    where: {
      id: gameId,
      leagueId: authorization.leagueId,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: { id: true },
  });

  if (!game) throw new AuthorizationError();

  return { ...authorization, gameId: game.id };
}

/** Clear the browser cookie and revoke its server-side session record. */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken && isValidToken(sessionToken)) {
    await db.commissionerSession.deleteMany({
      where: { token: { in: tokenStorageCandidates(sessionToken) } },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

function hashToken(token: string): string {
  // The prefix distinguishes one-way hashes from legacy raw 64-character
  // tokens. Without it, a leaked database hash could itself be replayed via the
  // temporary raw-token compatibility lookup.
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function newSessionValues(): {
  expiresAt: Date;
  rawToken: string;
  storedToken: string;
} {
  const rawToken = randomBytes(32).toString("hex");

  return {
    expiresAt: new Date(
      Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
    rawToken,
    storedToken: hashToken(rawToken),
  };
}

function tokenStorageCandidates(token: string): string[] {
  return [hashToken(token), token];
}

function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
