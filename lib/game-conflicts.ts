export type ScheduledGameForConflict = {
  awayTeamId: string;
  fieldName: string | null;
  homeTeamId: string;
  id: string;
  scheduledAt: Date | null;
  status: "COMPLETED" | "RAINED_OUT" | "RESCHEDULED" | "SCHEDULED";
};

export type ProposedGameSlot = {
  awayTeamId: string;
  fieldName: string | null;
  homeTeamId: string;
  id?: string;
  scheduledAt: Date;
};

export function intervalsOverlap(
  firstStart: Date,
  firstDurationMinutes: number,
  secondStart: Date,
  secondDurationMinutes: number,
): boolean {
  const firstEnd = firstStart.getTime() + firstDurationMinutes * 60_000;
  const secondEnd = secondStart.getTime() + secondDurationMinutes * 60_000;
  return firstStart.getTime() < secondEnd && secondStart.getTime() < firstEnd;
}

export function findGameConflict(
  proposed: ProposedGameSlot,
  games: readonly ScheduledGameForConflict[],
  durationMinutes: number,
): ScheduledGameForConflict | null {
  const proposedTeams = new Set([proposed.homeTeamId, proposed.awayTeamId]);
  const proposedField = normalizeField(proposed.fieldName);

  return (
    games.find((game) => {
      if (
        game.id === proposed.id ||
        !game.scheduledAt ||
        game.status === "RAINED_OUT" ||
        !intervalsOverlap(
          proposed.scheduledAt,
          durationMinutes,
          game.scheduledAt,
          durationMinutes,
        )
      ) {
        return false;
      }

      const teamConflict =
        proposedTeams.has(game.homeTeamId) || proposedTeams.has(game.awayTeamId);
      const fieldConflict =
        proposedField !== "" && proposedField === normalizeField(game.fieldName);
      return teamConflict || fieldConflict;
    }) ?? null
  );
}

function normalizeField(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}
