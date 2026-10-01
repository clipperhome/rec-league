"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";

import {
  assertActiveOrganizerInTransaction,
  AuthorizationError,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { recordLeagueActivity } from "@/lib/league-activity";
import { assignSchedule, zonedDateTimeToUtc } from "@/lib/schedule";
import {
  parseScheduleFormFields,
  readScheduleFormFields,
  type ScheduleFormFields,
  ScheduleFormValidationError,
} from "@/lib/schedule-form";
import {
  buildRebuildSchedulePlan,
  schedulePreviewFingerprint,
} from "@/lib/schedule-rebuild";

export async function applyScheduleSettingsAction(formData: FormData): Promise<never> {
  const slug = readString(formData, "slug");

  if (!slug) throw new AuthorizationError();

  const authorization = await requireCommissionerForLeague(slug);
  const draft = readScheduleFormFields(formData);
  let settings;

  try {
    settings = parseScheduleFormFields(draft);
  } catch (error) {
    redirectWithNotice(
      slug,
      error instanceof ScheduleFormValidationError
        ? error.message
        : "Those schedule settings could not be read.",
      "error",
      draft,
    );
  }

  const league = await db.league.findUnique({
    where: { id: authorization.leagueId },
    select: {
      games: {
        orderBy: [{ round: "asc" }, { id: "asc" }],
        select: {
          awayTeam: { select: { name: true } },
          fieldName: true,
          homeTeam: { select: { name: true } },
          id: true,
          locked: true,
          result: { select: { id: true } },
          round: true,
          scheduledAt: true,
          status: true,
          version: true,
        },
      },
      gameDurationMinutes: true,
      timezone: true,
    },
  });

  if (!league) throw new AuthorizationError();

  const gamesToSchedule = league.games.filter(
    (game) => !game.scheduledAt && !game.result && !game.locked,
  );
  const shiftedGameTimes = new Map<string, Date>();

  try {
    if (league.timezone !== settings.timeZone) {
      for (const game of league.games) {
        if (!game.scheduledAt) continue;
        const wallClock = getWallClock(game.scheduledAt, league.timezone);
        shiftedGameTimes.set(
          game.id,
          zonedDateTimeToUtc(wallClock.date, wallClock.time, settings.timeZone),
        );
      }
    }
  } catch (error) {
    console.error("Could not preserve game times in the new time zone.", error);
    redirectWithNotice(
      slug,
      "That time zone change makes an existing local game time invalid. Choose another zone or adjust the game first.",
      "error",
      draft,
    );
  }

  const occupiedGames = league.games.flatMap((game) =>
    game.scheduledAt && game.status !== "RAINED_OUT"
      ? [
          {
            away: game.awayTeam.name,
            fieldName: game.fieldName,
            home: game.homeTeam.name,
            round: game.round,
            scheduledAt: shiftedGameTimes.get(game.id) ?? game.scheduledAt,
            durationMinutes: settings.gameDurationMinutes,
          },
        ]
      : [],
  );
  let assigned;

  try {
    assigned = assignSchedule(
      gamesToSchedule.map((game) => ({
        away: game.awayTeam.name,
        home: game.homeTeam.name,
        round: game.round,
      })),
      settings,
      { occupiedGames },
    );
  } catch (error) {
    console.error("Could not assign league schedule.", error);
    redirectWithNotice(
      slug,
      "Those schedule settings don’t produce valid game times. Check the date, time zone, and start times.",
      "error",
      draft,
    );
  }

  const updates = gamesToSchedule.map((game, index) => {
    const slot = assigned[index];
    return {
      id: game.id,
      fieldName: slot.fieldName,
      scheduledAt: slot.scheduledAt,
      status:
        game.status === "RAINED_OUT" || game.status === "RESCHEDULED"
          ? ("RESCHEDULED" as const)
          : ("SCHEDULED" as const),
      version: game.version,
    };
  });
  const shiftedUpdates = league.games.flatMap((game) => {
    const scheduledAt = shiftedGameTimes.get(game.id);
    return scheduledAt
      ? [
          {
            id: game.id,
            fieldName: game.fieldName,
            scheduledAt,
            status: game.status,
            version: game.version,
          },
        ]
      : [];
  });
  const changedGameIds = [...updates, ...shiftedUpdates].map((game) => game.id);
  const gameSnapshot = league.games.map(({ id, version }) => ({ id, version }));
  const timingRulesChanged =
    league.gameDurationMinutes !== settings.gameDurationMinutes ||
    league.timezone !== settings.timeZone;

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        await assertGameSnapshot(tx, authorization.leagueId, gameSnapshot);
        await tx.league.update({
      where: { id: authorization.leagueId },
      data: {
        fieldNames: settings.fieldNames.join("\n") || null,
        gameDays: settings.gameDays.join(","),
        gameTimes: settings.gameTimes.join("\n"),
        gameDurationMinutes: settings.gameDurationMinutes,
        scheduleStartDate: settings.startDate,
        timezone: settings.timeZone,
        version: { increment: 1 },
      },
        });

        for (const game of [...updates, ...shiftedUpdates]) {
          const changed = await tx.game.updateMany({
        where: { id: game.id, version: game.version },
        data: {
          fieldName: game.fieldName,
          scheduledAt: game.scheduledAt,
          status: game.status,
          version: { increment: 1 },
        },
          });
          if (changed.count !== 1) {
            throw new Error("A game changed while the schedule was being saved.");
          }
        }
        if (timingRulesChanged) {
          await tx.game.updateMany({
        where: {
          leagueId: authorization.leagueId,
          ...(changedGameIds.length ? { id: { notIn: changedGameIds } } : {}),
        },
        data: { version: { increment: 1 } },
          });
        }
        await recordLeagueActivity(tx, {
      actorEmail: authorization.email,
      actorRole: "ORGANIZER",
      leagueId: authorization.leagueId,
      summary: updates.length
        ? `Scheduled ${updates.length} previously undated game${updates.length === 1 ? "" : "s"}.`
        : "Updated schedule settings.",
      type: "SCHEDULE_SETTINGS_UPDATED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    console.error("Could not save schedule settings.", error);
    redirectWithNotice(
      slug,
      "The schedule changed while these settings were being saved. Review the latest board and try again.",
      "error",
      draft,
    );
  }

  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
  redirectWithNotice(
    slug,
    updates.length
      ? `${updates.length} ${updates.length === 1 ? "game is" : "games are"} now on the calendar.`
      : shiftedUpdates.length
        ? "Schedule settings saved. Existing local game times were preserved in the new time zone."
        : "Schedule settings saved. Existing game dates were left unchanged.",
    "success",
  );
}

export async function rebuildUnplayedScheduleAction(
  formData: FormData,
): Promise<never> {
  const slug = readString(formData, "slug");
  if (!slug) throw new AuthorizationError();
  const authorization = await requireCommissionerForLeague(slug);
  const draft = readScheduleFormFields(formData);

  let settings;
  try {
    settings = parseScheduleFormFields(draft);
  } catch (error) {
    redirectWithNotice(
      slug,
      error instanceof ScheduleFormValidationError
        ? error.message
        : "Those schedule settings could not be read.",
      "error",
      draft,
    );
  }

  const league = await db.league.findUnique({
    where: { id: authorization.leagueId },
    select: {
      gameDurationMinutes: true,
      games: {
        orderBy: [{ round: "asc" }, { id: "asc" }],
        select: {
          awayTeam: { select: { name: true } },
          fieldName: true,
          homeTeam: { select: { name: true } },
          id: true,
          locked: true,
          result: { select: { id: true } },
          round: true,
          scheduledAt: true,
          status: true,
          version: true,
        },
      },
      timezone: true,
    },
  });
  if (!league) throw new AuthorizationError();

  let plan;
  try {
    plan = buildRebuildSchedulePlan(
      league.games.map((game) => ({
        away: game.awayTeam.name,
        fieldName: game.fieldName,
        hasResult: Boolean(game.result),
        home: game.homeTeam.name,
        id: game.id,
        locked: game.locked,
        round: game.round,
        scheduledAt: game.scheduledAt,
        status: game.status,
        version: game.version,
      })),
      league.timezone,
      settings,
    );
  } catch (error) {
    console.error("Could not rebuild the unplayed schedule.", error);
    redirectWithNotice(
      slug,
      "The unplayed schedule could not fit those days, times, and fields.",
      "error",
      draft,
    );
  }

  const gamesById = new Map(league.games.map((game) => [game.id, game]));
  const updates = plan.rebuilt.map((proposed) => {
    const game = gamesById.get(proposed.id);
    if (!game) throw new AuthorizationError();
    return {
      fieldName: proposed.fieldName,
      id: game.id,
      scheduledAt: proposed.scheduledAt,
      status:
        proposed.moved || game.status === "RAINED_OUT" || game.status === "RESCHEDULED"
          ? ("RESCHEDULED" as const)
          : ("SCHEDULED" as const),
      version: game.version,
    };
  });
  const durationChanged =
    league.gameDurationMinutes !== settings.gameDurationMinutes;
  const gameSnapshot = league.games.map(({ id, version }) => ({ id, version }));
  const preservedUpdates = plan.preserved.map((preserved) => {
    const game = gamesById.get(preserved.id);
    if (!game) throw new AuthorizationError();
    return {
      fieldName: game.fieldName,
      id: game.id,
      scheduledAt: preserved.scheduledAt,
      status: game.status,
      version: game.version,
    };
  });
  const expectedPreview = readString(formData, "previewFingerprint");
  const rebuildIntent = readString(formData, "rebuildIntent");
  const currentPreview = schedulePreviewFingerprint(gameSnapshot, settings);
  const isPreviewRequest = rebuildIntent !== "apply";
  if (isPreviewRequest || expectedPreview !== currentPreview) {
    redirectWithNotice(
      slug,
      isPreviewRequest
        ? expectedPreview === currentPreview
          ? "Rebuild preview refreshed. Nothing has changed yet."
          : "Rebuild preview ready. Review every changed game before applying it."
        : "The games or rhythm changed after the last preview. Review this updated rebuild before applying it.",
      isPreviewRequest ? "success" : "error",
      draft,
      true,
    );
  }

  try {
    await db.$transaction(
      async (tx) => {
        await assertActiveOrganizerInTransaction(tx, authorization);
        await assertGameSnapshot(tx, authorization.leagueId, gameSnapshot);
        await tx.league.update({
          where: { id: authorization.leagueId },
          data: {
            fieldNames: settings.fieldNames.join("\n") || null,
            gameDays: settings.gameDays.join(","),
            gameDurationMinutes: settings.gameDurationMinutes,
            gameTimes: settings.gameTimes.join("\n"),
            scheduleStartDate: settings.startDate,
            timezone: settings.timeZone,
            version: { increment: 1 },
          },
        });

        for (const game of updates) {
          const changed = await tx.game.updateMany({
            where: {
              id: game.id,
              locked: false,
              result: null,
              version: game.version,
            },
            data: {
              fieldName: game.fieldName,
              scheduledAt: game.scheduledAt,
              status: game.status,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) {
            throw new Error("A game changed while the schedule was rebuilding.");
          }
        }
        for (const game of preservedUpdates) {
          const changed = await tx.game.updateMany({
            where: {
              id: game.id,
              version: game.version,
            },
            data: {
              fieldName: game.fieldName,
              scheduledAt: game.scheduledAt,
              status: game.status,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) {
            throw new Error("A completed game changed while the schedule was rebuilding.");
          }
        }
        if (durationChanged) {
          await tx.game.updateMany({
            where: {
              leagueId: authorization.leagueId,
              ...(updates.length || preservedUpdates.length
                ? {
                    id: {
                      notIn: [...updates, ...preservedUpdates].map(
                        (game) => game.id,
                      ),
                    },
                  }
                : {}),
            },
            data: { version: { increment: 1 } },
          });
        }
        await recordLeagueActivity(tx, {
          actorEmail: authorization.email,
          actorRole: "ORGANIZER",
          leagueId: authorization.leagueId,
          summary: `Rebuilt ${updates.length} unplayed game${updates.length === 1 ? "" : "s"}; finals stayed fixed.`,
          type: "SCHEDULE_REBUILT",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    console.error("Could not save the rebuilt schedule.", error);
    redirectWithNotice(
      slug,
      "A game changed while the schedule was rebuilding. Review the latest board and try again.",
      "error",
      draft,
    );
  }

  revalidatePath(`/dashboard/${slug}`);
  revalidatePath(`/l/${slug}`);
  redirectWithNotice(
    slug,
    `${updates.length} unplayed ${updates.length === 1 ? "game was" : "games were"} rebuilt. Final scores and locked games stayed in place.`,
    "success",
  );
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function assertGameSnapshot(
  tx: Prisma.TransactionClient,
  leagueId: string,
  expectedGames: Array<{ id: string; version: number }>,
): Promise<void> {
  const currentGames = await tx.game.findMany({
    where: { leagueId },
    select: { id: true, version: true },
  });
  if (currentGames.length !== expectedGames.length) {
    throw new Error("The league schedule changed while it was being prepared.");
  }

  const currentVersions = new Map(
    currentGames.map((game) => [game.id, game.version]),
  );
  if (
    expectedGames.some(
      (game) => currentVersions.get(game.id) !== game.version,
    )
  ) {
    throw new Error("The league schedule changed while it was being prepared.");
  }
}

function getWallClock(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function redirectWithNotice(
  slug: string,
  notice: string,
  tone: "error" | "success",
  draft?: ScheduleFormFields,
  showRebuildPreview = false,
): never {
  const search = new URLSearchParams({ notice, tone });
  search.set("view", "settings");
  if (draft) {
    search.set("scheduleDraft", "1");
    search.set("draftStartDate", draft.startDate.slice(0, 20));
    search.set("draftTimezone", draft.timezone.slice(0, 100));
    search.set(
      "draftDuration",
      (draft.gameDurationMinutes ?? "").slice(0, 20),
    );
    search.set("draftDays", draft.gameDays.join(",").slice(0, 40));
    search.set("draftTimes", draft.gameTimes.slice(0, 500));
    search.set("draftFields", draft.fieldNames.slice(0, 2_000));
  }
  if (showRebuildPreview) search.set("previewRebuild", "1");
  redirect(`/dashboard/${slug}?${search.toString()}`);
}
