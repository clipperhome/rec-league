"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  AuthorizationError,
  generateMagicLinkToken,
  requireCommissionerForLeague,
  requireTeamManagerForGame,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmailConfiguration } from "@/lib/email";
import { findGameConflict } from "@/lib/game-conflicts";
import { recordLeagueActivity } from "@/lib/league-activity";
import { managerReportRuleViolation } from "@/lib/manager-report-rules";
import {
  buildMagicLinkUrl,
  deliverMagicLink,
} from "@/lib/magic-link-delivery";
import { consumeRateLimit } from "@/lib/rate-limit";
import { zonedDateTimeToUtc } from "@/lib/schedule";

type ReportType = "RAINOUT" | "RESCHEDULE" | "SCORE";

class ManagerWorkflowError extends Error {}

export async function inviteTeamManagerAction(
  formData: FormData,
): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const teamId = readString(formData, "teamId").trim();
  const email = readString(formData, "email").trim().toLowerCase();

  if (!slug || !teamId) throw new AuthorizationError();
  if (!isValidEmail(email)) {
    redirectToOrganizer(slug, "Enter a valid manager email address.", "error", "teams");
  }

  const authorization = await requireCommissionerForLeague(slug);
  if (email === authorization.email) {
    redirectToOrganizer(
      slug,
      "You already have organizer access to every team.",
      "error",
      "teams",
    );
  }

  if (process.env.NODE_ENV === "production") {
    try {
      getEmailConfiguration();
    } catch (error) {
      console.error("Team-manager email is not configured.", error);
      redirectToOrganizer(
        slug,
        "Invitations can’t be sent right now. Check the email configuration.",
        "error",
        "teams",
      );
    }
  }

  const allowed = await consumeRateLimit("manager-invite", [
    {
      identifier: `league:${authorization.leagueId}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    },
    { identifier: `email:${email}`, limit: 5, windowMs: 60 * 60 * 1000 },
  ]);
  if (!allowed) {
    redirectToOrganizer(
      slug,
      "That invitation was requested recently. Wait a few minutes before resending.",
      "error",
      "teams",
    );
  }

  let target: { leagueName: string; teamName: string };
  let localInviteUrl: string | null = null;

  try {
    target = await db.$transaction(
      async (tx) => {
        const team = await tx.team.findFirst({
          where: { id: teamId, leagueId: authorization.leagueId },
          select: {
            id: true,
            name: true,
            league: { select: { archivedAt: true, name: true } },
          },
        });
        const league = await tx.league.findUnique({
          where: { id: authorization.leagueId },
          select: { archivedAt: true, commissionerEmail: true },
        });
        if (
          !team ||
          !league?.commissionerEmail ||
          league.archivedAt ||
          league.commissionerEmail.trim().toLowerCase() !== authorization.email
        ) {
          throw new AuthorizationError();
        }

        await tx.teamManager.upsert({
          where: { teamId_email: { email, teamId } },
          create: {
            email,
            leagueId: authorization.leagueId,
            teamId,
          },
          update: {},
        });
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: authorization.leagueId,
          summary: `Invited ${email} to manage ${team.name}.`,
          teamId,
          touchesPublicPage: false,
          type: "MANAGER_INVITED",
        });

        return { leagueName: team.league.name, teamName: team.name };
      },
      { isolationLevel: "Serializable" },
    );

    const token = await generateMagicLinkToken(email, authorization.leagueId, {
      purpose: "TEAM_MANAGER_INVITE",
      teamId,
    });
    const magicLinkUrl = await buildMagicLinkUrl(token);
    if (process.env.NODE_ENV !== "production") localInviteUrl = magicLinkUrl;
    await deliverMagicLink({
      email,
      intent: "manager-invite",
      leagueName: target.leagueName,
      magicLinkUrl,
      roleLabel: `${target.teamName} team manager`,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not invite a team manager.", error);
    redirectToOrganizer(
      slug,
      "The manager invitation could not be created. Try again.",
      "error",
      "teams",
    );
  }

  revalidatePath(`/dashboard/${slug}`);
  redirectToOrganizer(
    slug,
    process.env.NODE_ENV === "production"
      ? `Invitation sent to ${email}.`
      : `Local invitation created for ${email}. Open the test link below to accept it.`,
    "success",
    "teams",
    localInviteUrl,
  );
}

export async function revokeTeamManagerAction(
  formData: FormData,
): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const managerId = readString(formData, "managerId").trim();
  if (!slug || !managerId) throw new AuthorizationError();

  const authorization = await requireCommissionerForLeague(slug);
  let revokedEmail = "That manager";

  await db.$transaction(
    async (tx) => {
      const league = await tx.league.findUnique({
        where: { id: authorization.leagueId },
        select: { archivedAt: true, commissionerEmail: true },
      });
      if (
        !league?.commissionerEmail ||
        league.archivedAt ||
        league.commissionerEmail.trim().toLowerCase() !== authorization.email
      ) {
        throw new AuthorizationError();
      }
      const manager = await tx.teamManager.findFirst({
        where: { id: managerId, leagueId: authorization.leagueId },
        select: { email: true, teamId: true, team: { select: { name: true } } },
      });
      if (!manager) throw new AuthorizationError();
      revokedEmail = manager.email;

      await tx.magicLinkToken.deleteMany({
        where: {
          email: manager.email,
          leagueId: authorization.leagueId,
          teamId: manager.teamId,
          usedAt: null,
        },
      });
      await tx.teamManager.delete({ where: { id: managerId } });
      await recordLeagueActivity(tx, {
        actorEmail: authorization.email,
        actorRole: "ORGANIZER",
        leagueId: authorization.leagueId,
        summary: `Removed ${manager.email} from ${manager.team.name}.`,
        teamId: manager.teamId,
        touchesPublicPage: false,
        type: "MANAGER_REVOKED",
      });
    },
    { isolationLevel: "Serializable" },
  );

  revalidatePath(`/dashboard/${slug}`);
  redirectToOrganizer(
    slug,
    `${revokedEmail} no longer has access to this team.`,
    "success",
    "teams",
  );
}

export async function submitGameReportAction(
  formData: FormData,
): Promise<never> {
  const teamId = readString(formData, "teamId").trim();
  const gameId = readString(formData, "gameId").trim();
  const type = readString(formData, "type") as ReportType;
  const expectedGameVersion = parseGameVersion(
    readString(formData, "expectedGameVersion"),
  );
  if (
    !teamId ||
    !gameId ||
    !isReportType(type) ||
    expectedGameVersion === null
  ) {
    throw new AuthorizationError();
  }

  const authorization = await requireTeamManagerForGame(teamId, gameId);

  try {
    await db.$transaction(
      async (tx) => {
        if (authorization.isCommissioner) {
          const league = await tx.league.findUnique({
            where: { id: authorization.leagueId },
            select: { archivedAt: true, commissionerEmail: true },
          });
          if (
            !league?.commissionerEmail ||
            league.archivedAt ||
            league.commissionerEmail.trim().toLowerCase() !== authorization.email
          ) {
            throw new AuthorizationError();
          }
        } else {
          const assignment = await tx.teamManager.findFirst({
            where: {
              acceptedAt: { not: null },
              email: authorization.email,
              leagueId: authorization.leagueId,
              teamId,
              team: { leagueId: authorization.leagueId },
            },
            select: { id: true },
          });
          if (!assignment) throw new AuthorizationError();
        }

        const game = await tx.game.findFirst({
          where: {
            id: gameId,
            leagueId: authorization.leagueId,
            OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
          },
          select: {
            awayTeamId: true,
            homeTeamId: true,
            id: true,
            league: {
              select: {
                archivedAt: true,
                gameDurationMinutes: true,
                timezone: true,
              },
            },
            locked: true,
            result: { select: { id: true } },
            version: true,
          },
        });
        if (!game || game.league.archivedAt) throw new AuthorizationError();
        if (game.version !== expectedGameVersion) {
          throw new ManagerWorkflowError(
            "That game changed while this form was open. Review the latest details and send a fresh report.",
          );
        }
        if (game.locked) {
          throw new ManagerWorkflowError(
            "That game is locked. Ask the organizer to unlock it first.",
          );
        }
        const values = parseReportValues(formData, type, game.league.timezone);
        const games =
          type === "RESCHEDULE" && values.proposedScheduledAt
            ? await tx.game.findMany({
            where: { leagueId: authorization.leagueId },
            select: {
              awayTeamId: true,
              fieldName: true,
              homeTeamId: true,
              id: true,
              scheduledAt: true,
              status: true,
            },
          })
            : [];
        const ruleViolation = managerReportRuleViolation({
          game: {
            awayTeamId: game.awayTeamId,
            hasResult: Boolean(game.result),
            homeTeamId: game.homeTeamId,
            id: game.id,
          },
          gameDurationMinutes: game.league.gameDurationMinutes,
          games,
          leagueTimeZone: game.league.timezone,
          proposedSlot: values.proposedScheduledAt
            ? {
                fieldName: values.proposedFieldName,
                scheduledAt: values.proposedScheduledAt,
                timeZone: game.league.timezone,
              }
            : null,
          reportType: type,
        });
        if (ruleViolation) {
          throw new ManagerWorkflowError(ruleViolation);
        }

        const pendingKey = `${gameId}:${teamId}:${type}`;
        const replacedAt = new Date();
        await tx.gameReport.updateMany({
          where: { pendingKey, status: "PENDING" },
          data: {
            decisionNote: "Replaced by a newer report from the team manager.",
            pendingKey: null,
            reviewedAt: replacedAt,
            status: "REJECTED",
            version: { increment: 1 },
          },
        });
        await tx.gameReport.create({
          data: {
            ...values,
            gameId,
            gameVersion: game.version,
            leagueId: authorization.leagueId,
            pendingKey,
            submittedByEmail: authorization.email,
            teamId,
            type,
          },
        });
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "MANAGER",
          gameId,
          leagueId: authorization.leagueId,
          summary: `${authorization.teamName} submitted a ${reportTypeLabel(type)} report.`,
          teamId,
          touchesPublicPage: false,
          type: "REPORT_SUBMITTED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not submit game report.", error);
    redirectToTeam(
      teamId,
      error instanceof ManagerWorkflowError
        ? error.message
        : "That report could not be submitted. Try again.",
      "error",
    );
  }

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/dashboard/${authorization.slug}`);
  redirectToTeam(
    teamId,
    "Report sent to the organizer. The public league record is unchanged until approval.",
    "success",
  );
}

export async function reviewGameReportAction(
  formData: FormData,
): Promise<never> {
  const slug = readString(formData, "slug").trim();
  const reportId = readString(formData, "reportId").trim();
  const decision = readString(formData, "decision");
  const decisionNote = readString(formData, "decisionNote").trim();
  if (!slug || !reportId || !["approve", "reject"].includes(decision)) {
    throw new AuthorizationError();
  }
  if (decisionNote.length > 500) {
    redirectToOrganizer(slug, "Keep the review note under 500 characters.", "error", "requests");
  }

  const authorization = await requireCommissionerForLeague(slug);
  let affectedTeamIds: string[] = [];

  try {
    affectedTeamIds = await db.$transaction(
      async (tx) => {
        const report = await tx.gameReport.findFirst({
          where: { id: reportId, leagueId: authorization.leagueId },
          include: {
            game: { include: { result: true } },
            league: true,
            team: true,
          },
        });
        if (
          !report ||
          report.league.archivedAt ||
          !report.league.commissionerEmail ||
          report.league.commissionerEmail.trim().toLowerCase() !==
            authorization.email ||
          report.team.leagueId !== authorization.leagueId ||
          report.game.leagueId !== authorization.leagueId ||
          (report.game.homeTeamId !== report.teamId &&
            report.game.awayTeamId !== report.teamId)
        ) {
          throw new AuthorizationError();
        }
        if (report.status !== "PENDING") {
          throw new ManagerWorkflowError(
            "That report was already replaced or reviewed. Refresh the queue.",
          );
        }

        const reviewedAt = new Date();
        if (decision === "reject") {
          await tx.gameReport.update({
            where: { id: report.id },
            data: {
              decisionNote: decisionNote || null,
              pendingKey: null,
              reviewedAt,
              reviewedByEmail: authorization.email,
              status: "REJECTED",
              version: { increment: 1 },
            },
          });
          await recordLeagueActivity(tx, {
            actorEmail: authorization.email,
            actorRole: "ORGANIZER",
            gameId: report.gameId,
            leagueId: authorization.leagueId,
            summary: `Declined ${report.team.name}’s ${reportTypeLabel(report.type)} report.`,
            teamId: report.teamId,
            touchesPublicPage: false,
            type: "REPORT_REJECTED",
          });
          return [report.game.homeTeamId, report.game.awayTeamId];
        }

        if (report.game.version !== report.gameVersion) {
          throw new ManagerWorkflowError(
            "The official game changed after this report was sent. Decline it and ask for a fresh report.",
          );
        }
        await applyApprovedReport(tx, report);

        await tx.gameReport.update({
          where: { id: report.id },
          data: {
            decisionNote: decisionNote || null,
            pendingKey: null,
            reviewedAt,
            reviewedByEmail: authorization.email,
            status: "APPROVED",
            version: { increment: 1 },
          },
        });
        await tx.gameReport.updateMany({
          where: {
            gameId: report.gameId,
            id: { not: report.id },
            status: "PENDING",
          },
          data: {
            decisionNote: "Superseded by an approved update to the official game.",
            pendingKey: null,
            reviewedAt,
            reviewedByEmail: authorization.email,
            status: "REJECTED",
            version: { increment: 1 },
          },
        });
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          gameId: report.gameId,
          leagueId: authorization.leagueId,
          summary: `Approved ${report.team.name}’s ${reportTypeLabel(report.type)} report.`,
          teamId: report.teamId,
          type: "REPORT_APPROVED",
        });
        return [report.game.homeTeamId, report.game.awayTeamId];
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not review game report.", error);
    redirectToOrganizer(
      slug,
      error instanceof ManagerWorkflowError
        ? error.message
        : "That report could not be reviewed. Try again.",
      "error",
      "requests",
    );
  }

  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
  for (const teamId of new Set(affectedTeamIds)) {
    revalidatePath(`/team/${teamId}`);
  }
  redirectToOrganizer(
    slug,
    decision === "approve"
      ? "Report approved. The official league page is updated."
      : "Report declined. The official league page was not changed.",
    "success",
    "requests",
  );
}

async function applyApprovedReport(
  tx: Prisma.TransactionClient,
  report: Prisma.GameReportGetPayload<{
    include: {
      game: { include: { result: true } };
      league: true;
      team: true;
    };
  }>,
): Promise<void> {
  if (report.type === "SCORE") {
    if (
      report.game.locked ||
      report.homeScore === null ||
      report.awayScore === null
    ) {
      throw new ManagerWorkflowError("That score can no longer be applied.");
    }
    await tx.result.upsert({
      where: { gameId: report.gameId },
      create: {
        awayScore: report.awayScore,
        gameId: report.gameId,
        homeScore: report.homeScore,
      },
      update: {
        awayScore: report.awayScore,
        homeScore: report.homeScore,
        version: { increment: 1 },
      },
    });
    await tx.game.update({
      where: { id: report.gameId },
      data: { status: "COMPLETED", version: { increment: 1 } },
    });
    return;
  }

  if (report.type === "RAINOUT") {
    if (report.game.locked || report.game.result) {
      throw new ManagerWorkflowError("A locked or final game cannot become a rainout.");
    }
    await tx.game.update({
      where: { id: report.gameId },
      data: { status: "RAINED_OUT", version: { increment: 1 } },
    });
    return;
  }

  if (
    report.game.locked ||
    report.game.result ||
    !report.proposedScheduledAt
  ) {
    throw new ManagerWorkflowError("That reschedule can no longer be applied.");
  }
  const games = await tx.game.findMany({
    where: { leagueId: report.leagueId },
    select: {
      awayTeamId: true,
      fieldName: true,
      homeTeamId: true,
      id: true,
      scheduledAt: true,
      status: true,
    },
  });
  if (
    findGameConflict(
      {
        awayTeamId: report.game.awayTeamId,
        fieldName: report.proposedFieldName,
        homeTeamId: report.game.homeTeamId,
        id: report.game.id,
        scheduledAt: report.proposedScheduledAt,
      },
      games,
      report.league.gameDurationMinutes,
    )
  ) {
    throw new ManagerWorkflowError(
      "That proposed time now overlaps another team or field.",
    );
  }
  await tx.game.update({
    where: { id: report.gameId },
    data: {
      fieldName: report.proposedFieldName?.trim() || null,
      scheduledAt: report.proposedScheduledAt,
      status: "RESCHEDULED",
      version: { increment: 1 },
    },
  });
}

function parseReportValues(
  formData: FormData,
  type: ReportType,
  timeZone: string,
): {
  awayScore: number | null;
  homeScore: number | null;
  note: string | null;
  proposedFieldName: string | null;
  proposedScheduledAt: Date | null;
} {
  const note = readString(formData, "note").trim();
  if (note.length > 500) {
    throw new ManagerWorkflowError("Keep the note under 500 characters.");
  }

  if (type === "SCORE") {
    const homeScore = parseScore(readString(formData, "homeScore"));
    const awayScore = parseScore(readString(formData, "awayScore"));
    if (homeScore === null || awayScore === null) {
      throw new ManagerWorkflowError(
        "Enter whole-number scores between 0 and 999.",
      );
    }
    return {
      awayScore,
      homeScore,
      note: note || null,
      proposedFieldName: null,
      proposedScheduledAt: null,
    };
  }

  if (type === "RESCHEDULE") {
    const date = readString(formData, "scheduledDate");
    const time = readString(formData, "scheduledTime");
    const fieldName = readString(formData, "fieldName").trim();
    if (fieldName.length > 80) {
      throw new ManagerWorkflowError("Keep the field name under 80 characters.");
    }
    let proposedScheduledAt: Date;
    try {
      proposedScheduledAt = zonedDateTimeToUtc(date, time, timeZone);
    } catch {
      throw new ManagerWorkflowError("Choose a valid local date and time.");
    }
    return {
      awayScore: null,
      homeScore: null,
      note: note || null,
      proposedFieldName: fieldName || null,
      proposedScheduledAt,
    };
  }

  return {
    awayScore: null,
    homeScore: null,
    note: note || null,
    proposedFieldName: null,
    proposedScheduledAt: null,
  };
}

function parseScore(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const score = Number(value);
  return Number.isSafeInteger(score) && score >= 0 && score <= 999 ? score : null;
}

function isReportType(value: string): value is ReportType {
  return value === "SCORE" || value === "RAINOUT" || value === "RESCHEDULE";
}

function reportTypeLabel(type: ReportType): string {
  return {
    RAINOUT: "rainout",
    RESCHEDULE: "reschedule",
    SCORE: "score",
  }[type];
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseGameVersion(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function redirectToOrganizer(
  slug: string,
  notice: string,
  tone: "error" | "success",
  view: "requests" | "teams",
  devInvite?: string | null,
): never {
  const search = new URLSearchParams({ notice, tone, view });
  if (process.env.NODE_ENV !== "production" && devInvite) {
    search.set("devInvite", devInvite);
  }
  redirect(`/dashboard/${slug}?${search.toString()}`);
}

function redirectToTeam(
  teamId: string,
  notice: string,
  tone: "error" | "success",
): never {
  const search = new URLSearchParams({ notice, tone });
  redirect(`/team/${teamId}?${search.toString()}`);
}
