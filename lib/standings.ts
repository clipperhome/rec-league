export type StandingsTeam = {
  id: string;
  name: string;
};

export type StandingsGame = {
  awayTeamId: string;
  homeTeamId: string;
  status: "COMPLETED" | "RAINED_OUT" | "RESCHEDULED" | "SCHEDULED";
  result:
    | {
        awayScore?: number | null;
        homeScore?: number | null;
      }
    | null;
};

export type StandingsRow = {
  goalDifferential: number;
  goalsAgainst: number;
  goalsFor: number;
  losses: number;
  played: number;
  points: number;
  teamId: string;
  teamName: string;
  ties: number;
  wins: number;
};

export function buildStandings(
  teams: StandingsTeam[],
  games: StandingsGame[],
): StandingsRow[] {
  const standings = new Map<string, StandingsRow>(
    teams.map((team) => [
      team.id,
      {
        goalDifferential: 0,
        goalsAgainst: 0,
        goalsFor: 0,
        losses: 0,
        played: 0,
        points: 0,
        teamId: team.id,
        teamName: team.name,
        ties: 0,
        wins: 0,
      },
    ]),
  );

  for (const game of games) {
    if (!game.result || game.status !== "COMPLETED") {
      continue;
    }

    const homeRow = standings.get(game.homeTeamId);
    const awayRow = standings.get(game.awayTeamId);

    if (!homeRow || !awayRow) {
      continue;
    }

    const homeScore = game.result.homeScore ?? 0;
    const awayScore = game.result.awayScore ?? 0;

    homeRow.played += 1;
    awayRow.played += 1;

    homeRow.goalsFor += homeScore;
    homeRow.goalsAgainst += awayScore;
    awayRow.goalsFor += awayScore;
    awayRow.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      homeRow.wins += 1;
      homeRow.points += 3;
      awayRow.losses += 1;
      continue;
    }

    if (awayScore > homeScore) {
      awayRow.wins += 1;
      awayRow.points += 3;
      homeRow.losses += 1;
      continue;
    }

    homeRow.ties += 1;
    awayRow.ties += 1;
    homeRow.points += 1;
    awayRow.points += 1;
  }

  return Array.from(standings.values())
    .map((row) => ({
      ...row,
      goalDifferential: row.goalsFor - row.goalsAgainst,
    }))
    .sort((left, right) => {
      if (right.points !== left.points) {
        return right.points - left.points;
      }

      if (right.goalDifferential !== left.goalDifferential) {
        return right.goalDifferential - left.goalDifferential;
      }

      if (right.goalsFor !== left.goalsFor) {
        return right.goalsFor - left.goalsFor;
      }

      return left.teamName.localeCompare(right.teamName);
    });
}
