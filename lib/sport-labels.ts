export type ScoreLabels = {
  /** Short column header for "scored" (e.g. GF, PF, RF) */
  scoreFor: string;
  /** Short column header for "allowed" (e.g. GA, PA, RA) */
  scoreAgainst: string;
  /** Short column header for differential (e.g. GD, PD, RD) */
  scoreDiff: string;
  /** Full word for a single unit of scoring (e.g. "goal", "point", "run") */
  unit: string;
};

const SPORT_LABELS: Record<string, ScoreLabels> = {
  soccer: {
    scoreFor: "GF",
    scoreAgainst: "GA",
    scoreDiff: "GD",
    unit: "goal",
  },
  hockey: {
    scoreFor: "GF",
    scoreAgainst: "GA",
    scoreDiff: "GD",
    unit: "goal",
  },
  football: {
    scoreFor: "PF",
    scoreAgainst: "PA",
    scoreDiff: "PD",
    unit: "point",
  },
  basketball: {
    scoreFor: "PF",
    scoreAgainst: "PA",
    scoreDiff: "PD",
    unit: "point",
  },
  baseball: {
    scoreFor: "RF",
    scoreAgainst: "RA",
    scoreDiff: "RD",
    unit: "run",
  },
  softball: {
    scoreFor: "RF",
    scoreAgainst: "RA",
    scoreDiff: "RD",
    unit: "run",
  },
  volleyball: {
    scoreFor: "SF",
    scoreAgainst: "SA",
    scoreDiff: "SD",
    unit: "set",
  },
  kickball: {
    scoreFor: "RF",
    scoreAgainst: "RA",
    scoreDiff: "RD",
    unit: "run",
  },
};

const DEFAULT_LABELS: ScoreLabels = {
  scoreFor: "PF",
  scoreAgainst: "PA",
  scoreDiff: "PD",
  unit: "point",
};

export function getScoreLabels(sport: string | null | undefined): ScoreLabels {
  if (!sport) return DEFAULT_LABELS;

  const key = sport.trim().toLowerCase();
  return SPORT_LABELS[key] ?? DEFAULT_LABELS;
}
