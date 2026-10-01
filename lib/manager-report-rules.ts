import {
  findGameConflict,
  type ScheduledGameForConflict,
} from "./game-conflicts";

export type ManagerReportRuleInput = {
  game: {
    awayTeamId: string;
    hasResult: boolean;
    homeTeamId: string;
    id: string;
  };
  gameDurationMinutes: number;
  games: readonly ScheduledGameForConflict[];
  leagueTimeZone: string;
  proposedSlot: {
    fieldName: string | null;
    scheduledAt: Date;
    timeZone: string;
  } | null;
  reportType: "RAINOUT" | "RESCHEDULE" | "SCORE";
};

/**
 * Shared policy for live and synchronized team-manager reports. Authorization,
 * record versions, and payload shape are checked by their respective callers.
 */
export function managerReportRuleViolation(
  input: ManagerReportRuleInput,
): string | null {
  if (input.game.hasResult && input.reportType !== "SCORE") {
    return "A final game can accept a corrected score report, but not a rainout or reschedule.";
  }

  if (input.reportType !== "RESCHEDULE" || !input.proposedSlot) return null;
  if (input.proposedSlot.timeZone !== input.leagueTimeZone) {
    return "The league time zone changed after this report was prepared.";
  }

  const conflict = findGameConflict(
    {
      awayTeamId: input.game.awayTeamId,
      fieldName: input.proposedSlot.fieldName,
      homeTeamId: input.game.homeTeamId,
      id: input.game.id,
      scheduledAt: input.proposedSlot.scheduledAt,
    },
    input.games,
    input.gameDurationMinutes,
  );
  return conflict
    ? `That proposed time overlaps game ${conflict.id} for a team or field.`
    : null;
}
