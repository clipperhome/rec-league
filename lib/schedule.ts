export type RoundRobinMatchup = {
  round: number;
  home: string;
  away: string;
};

const BYE_TEAM = "__BYE__";

export function generateRoundRobinSchedule(
  teamNames: string[],
  rounds: number,
): RoundRobinMatchup[] {
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error("rounds must be a positive integer");
  }

  const normalizedTeams = normalizeTeamNames(teamNames);

  if (normalizedTeams.length < 2) {
    return [];
  }

  const rotation = normalizedTeams.length % 2 === 0
    ? [...normalizedTeams]
    : [...normalizedTeams, BYE_TEAM];
  const roundsPerCycle = rotation.length - 1;
  const matchupsPerRound = rotation.length / 2;
  const schedule: RoundRobinMatchup[] = [];

  for (let cycle = 0; cycle < rounds; cycle += 1) {
    let currentOrder = [...rotation];

    for (let roundIndex = 0; roundIndex < roundsPerCycle; roundIndex += 1) {
      const roundNumber = cycle * roundsPerCycle + roundIndex + 1;

      for (let pairIndex = 0; pairIndex < matchupsPerRound; pairIndex += 1) {
        const firstTeam = currentOrder[pairIndex];
        const secondTeam = currentOrder[currentOrder.length - 1 - pairIndex];

        if (firstTeam === BYE_TEAM || secondTeam === BYE_TEAM) {
          continue;
        }

        const [home, away] = resolveHomeAway(
          firstTeam,
          secondTeam,
          roundIndex,
          pairIndex,
          cycle,
        );

        schedule.push({
          round: roundNumber,
          home,
          away,
        });
      }

      currentOrder = rotateTeams(currentOrder);
    }
  }

  return schedule;
}

function normalizeTeamNames(teamNames: string[]): string[] {
  const normalizedTeams = teamNames.map((teamName) => teamName.trim());

  if (normalizedTeams.some((teamName) => teamName.length === 0)) {
    throw new Error("team names must be non-empty");
  }

  if (new Set(normalizedTeams).size !== normalizedTeams.length) {
    throw new Error("team names must be unique");
  }

  return normalizedTeams;
}

function resolveHomeAway(
  firstTeam: string,
  secondTeam: string,
  roundIndex: number,
  pairIndex: number,
  cycle: number,
): [string, string] {
  let swapHomeAway = pairIndex === 0 ? roundIndex % 2 === 1 : pairIndex % 2 === 0;

  if (cycle % 2 === 1) {
    swapHomeAway = !swapHomeAway;
  }

  return swapHomeAway ? [secondTeam, firstTeam] : [firstTeam, secondTeam];
}

function rotateTeams(teams: string[]): string[] {
  const [fixedTeam, ...rotatingTeams] = teams;
  const lastTeam = rotatingTeams[rotatingTeams.length - 1];

  return [fixedTeam, lastTeam, ...rotatingTeams.slice(0, -1)];
}
