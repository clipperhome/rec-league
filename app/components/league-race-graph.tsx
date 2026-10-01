import type { StandingsRow } from "@/lib/standings";

type LeagueRaceGraphProps = {
  differentialLabel: string;
  selectedTeamId?: string;
  standings: StandingsRow[];
};

export function LeagueRaceGraph({
  differentialLabel,
  selectedTeamId,
  standings,
}: LeagueRaceGraphProps) {
  const axisMaximum = Math.max(1, ...standings.map((row) => row.points));

  return (
    <figure aria-label="League standings plotted by points">
      <figcaption className="sr-only">
        Teams are ordered by official rank. Their marker position shows league
        points from zero to {axisMaximum}.
      </figcaption>
      <ol className="divide-y divide-[#edf1ee]">
        {standings.map((row, index) => {
          const selected = row.teamId === selectedTeamId;
          const position = Math.min(100, Math.max(0, (row.points / axisMaximum) * 100));

          return (
            <li
              className={`py-3 ${selected ? "-mx-2 rounded-xl bg-amber-50 px-2" : ""}`}
              key={row.teamId}
            >
              <span className="sr-only">
                Rank {index + 1}, {row.teamName}, {row.played} played, {row.wins}
                {" "}wins, {row.losses} losses, {row.ties} ties, {row.points}
                {" "}{row.points === 1 ? "point" : "points"}, {differentialLabel}
                {" "}{signedNumber(row.goalDifferential)}.
                {selected ? " Your team." : ""}
              </span>
              <div aria-hidden="true">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 w-5 shrink-0 text-sm font-bold tabular-nums text-[#829087]">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-[#10231c]">
                        {row.teamName}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-[#627068]">
                        {row.wins}W · {row.losses}L · {row.ties}T · {differentialLabel}{" "}
                        {signedNumber(row.goalDifferential)}
                      </p>
                      {selected ? (
                        <p className="mt-0.5 text-xs font-bold text-amber-800">Your team</p>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-black tabular-nums text-[#10231c]">
                    {row.points} pts
                  </span>
                </div>

                <div className="relative mt-2 h-10" role="presentation">
                  <div className="absolute inset-x-5 top-1/2 h-full -translate-y-1/2">
                    <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#dfe7e1]" />
                    <span className="absolute left-1/2 top-2 bottom-2 w-px bg-[#cad7cf]" />
                    <span
                      className={`absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full ${selected ? "bg-[#d89a1d]" : "bg-[#0f6a48]"}`}
                      style={{ width: `${position}%` }}
                    />
                    <span
                      className={`absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-black tabular-nums shadow-sm ${
                        selected
                          ? "bg-[#f4b942] text-[#10231c] ring-4 ring-amber-100"
                          : "bg-[#10231c] text-white ring-4 ring-white"
                      }`}
                      style={{ left: `${position}%` }}
                    >
                      {row.points}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="px-5 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold tabular-nums text-[#627068]">
          <span>0</span>
          <span>{axisMaximum}</span>
        </div>
        <p className="-mt-4 text-center text-xs font-semibold text-[#627068]">
          League points
        </p>
      </div>
    </figure>
  );
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
