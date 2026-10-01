export type PublicGameState =
  | "final"
  | "in-progress"
  | "rained-out"
  | "rescheduled"
  | "result-pending"
  | "scheduled"
  | "tbd";

export type GameStateInput = {
  result: unknown | null;
  scheduledAt: Date | null;
  status: "COMPLETED" | "RAINED_OUT" | "RESCHEDULED" | "SCHEDULED";
};

/**
 * One canonical public state classifier. Rainouts deliberately outrank stale
 * result data, and a result is final only when the official game state agrees.
 */
export function classifyGameState(
  game: GameStateInput,
  gameDurationMinutes: number,
  now = new Date(),
): PublicGameState {
  if (game.status === "RAINED_OUT") return "rained-out";
  if (game.status === "COMPLETED" && game.result) return "final";
  if (game.status === "COMPLETED") return "result-pending";
  if (!game.scheduledAt) return "tbd";

  const startsAt = game.scheduledAt.getTime();
  const endsAt = startsAt + gameDurationMinutes * 60_000;
  const current = now.getTime();

  if (current < startsAt) {
    return game.status === "RESCHEDULED" ? "rescheduled" : "scheduled";
  }
  if (current < endsAt) return "in-progress";
  return "result-pending";
}
