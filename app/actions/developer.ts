"use server";

import { notFound, redirect } from "next/navigation";

import {
  clearSessionCookie,
  createVerifiedSession,
  setSessionCookie,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  developmentManagerEmail,
  isLocalDevelopmentRequest,
} from "@/lib/developer-tools";

type DeveloperProfile = "manager" | "organizer" | "public";

export async function switchDeveloperProfileAction(
  formData: FormData,
): Promise<never> {
  if (!(await isLocalDevelopmentRequest())) notFound();

  const leagueId = readFormValue(formData, "leagueId");
  const profile = readFormValue(formData, "profile") as DeveloperProfile;
  if (!leagueId || !["manager", "organizer", "public"].includes(profile)) {
    redirect("/");
  }

  const league = await db.league.findFirst({
    where: { archivedAt: null, id: leagueId },
    select: {
      commissionerEmail: true,
      id: true,
      slug: true,
      teams: {
        orderBy: { createdAt: "asc" },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!league) redirect("/");

  await clearSessionCookie();

  if (profile === "public") {
    redirect(`/l/${encodeURIComponent(league.slug)}`);
  }

  if (profile === "organizer") {
    if (!league.commissionerEmail) {
      redirect(`/l/${encodeURIComponent(league.slug)}`);
    }

    const sessionToken = await createVerifiedSession(
      league.commissionerEmail,
      league.id,
      { revokeBootstrap: false },
    );
    await setSessionCookie(sessionToken);
    redirect(`/dashboard/${encodeURIComponent(league.slug)}`);
  }

  const team = league.teams[0];
  if (!team) redirect(`/dashboard/${encodeURIComponent(league.slug)}?view=teams`);

  const email = developmentManagerEmail(league.id);
  const manager = await db.teamManager.upsert({
    where: { teamId_email: { email, teamId: team.id } },
    create: {
      acceptedAt: new Date(),
      email,
      leagueId: league.id,
      teamId: team.id,
    },
    update: {
      acceptedAt: new Date(),
      leagueId: league.id,
    },
    select: { email: true, teamId: true },
  });

  const sessionToken = await createVerifiedSession(manager.email, league.id, {
    revokeBootstrap: false,
  });
  await setSessionCookie(sessionToken);
  redirect(`/team/${encodeURIComponent(manager.teamId)}`);
}

function readFormValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value.trim() : "";
}
