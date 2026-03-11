import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { db } from "./db";

const SESSION_COOKIE_NAME = "commissioner_session";
const MAGIC_LINK_EXPIRY_MINUTES = 15;
const SESSION_EXPIRY_DAYS = 30;

export async function generateMagicLinkToken(
  email: string,
  leagueId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
  );

  await db.magicLinkToken.create({
    data: {
      token,
      email: email.toLowerCase().trim(),
      leagueId,
      expiresAt,
    },
  });

  return token;
}

export async function verifyMagicLinkToken(
  token: string,
): Promise<{ email: string; leagueId: string; slug: string } | null> {
  const record = await db.magicLinkToken.findUnique({
    where: { token },
    include: {
      league: {
        select: { slug: true },
      },
    },
  });

  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;

  await db.magicLinkToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return {
    email: record.email,
    leagueId: record.leagueId,
    slug: record.league.slug,
  };
}

export async function createSession(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.commissionerSession.create({
    data: {
      token,
      email: email.toLowerCase().trim(),
      expiresAt,
    },
  });

  return token;
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

export async function getCommissionerSession(
  slug: string,
): Promise<{ email: string } | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) return null;

  const session = await db.commissionerSession.findUnique({
    where: { token: sessionToken },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) return null;

  const league = await db.league.findUnique({
    where: { slug },
    select: { commissionerEmail: true },
  });

  if (!league) return null;
  if (!league.commissionerEmail) return null;
  if (session.email !== league.commissionerEmail.toLowerCase().trim()) {
    return null;
  }

  return { email: session.email };
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete(SESSION_COOKIE_NAME);
}
