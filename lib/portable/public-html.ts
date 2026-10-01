import { classifyGameState, type PublicGameState } from "../game-state";
import { getScoreLabels } from "../sport-labels";
import { buildStandings } from "../standings";
import { assertPortableDocument } from "./validate";
import type { LeagueDocumentV1, PortableGame } from "./types";

const RACE_POSITION_CSS = Array.from(
  { length: 101 },
  (_, value) => `.race-position-${value}{--race-position:${value}%}`,
).join("");

const SNAPSHOT_CSS = String.raw`
:root{color:#10231c;background:#f3f6f2;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}*{box-sizing:border-box}body{margin:0;min-width:320px;background:#f3f6f2}a{color:inherit}button,select{font:inherit}:focus-visible{outline:3px solid #f4b942;outline-offset:2px}.shell{width:min(1120px,calc(100% - 2rem));margin:0 auto}.top{border-bottom:1px solid #d9e2dc;background:#fff}.topin{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0}.brand{display:flex;align-items:center;gap:.75rem;font-weight:900}.logo{display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:.8rem;background:#0f5138;color:#fff}.offline{border:1px solid #cad7cf;border-radius:999px;padding:.4rem .7rem;font-size:.78rem;font-weight:800;color:#526159}.main{padding:2rem 0 4rem}.eyebrow{margin:0;color:#0f6a48;font-size:.78rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase}h1{margin:.45rem 0 0;font-size:clamp(2.3rem,8vw,4.5rem);line-height:.95;letter-spacing:-.045em}h2{margin:.3rem 0 0;font-size:1.65rem;letter-spacing:-.025em}.sub{margin:.8rem 0 0;color:#627068}.notice{margin-top:1.25rem;border:1px solid #f2c766;border-radius:.8rem;background:#fff7df;padding:.85rem 1rem;color:#5b4311}.toolbar{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:1rem;margin-top:1.7rem;padding:1rem;border:1px solid #cad7cf;border-radius:1rem;background:#fff}.toolbar label{font-size:.8rem;font-weight:900}.toolbar select{display:block;min-height:2.7rem;margin-top:.35rem;border:1px solid #bdcbc2;border-radius:.6rem;background:#fff;padding:0 .8rem;color:#10231c}.fresh{font-size:.85rem;color:#627068}.hero{margin-top:1.4rem;border-radius:1.3rem;background:#10231c;color:#fff;overflow:hidden;box-shadow:0 18px 45px rgba(16,35,28,.16)}.herohead{border-bottom:1px solid rgba(255,255,255,.1);padding:1rem 1.25rem;color:#8fd1ad;font-size:.78rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.herobody{padding:1.3rem}.herobody h2{font-size:clamp(1.55rem,5vw,2.35rem)}.herobody p{margin:.7rem 0 0;color:rgba(255,255,255,.72)}.layout{display:grid;gap:1.5rem;margin-top:1.6rem}.section{margin-top:1.8rem}.section:first-child{margin-top:0}.count{color:#829087;font-size:.85rem}.heading{display:flex;align-items:end;justify-content:space-between;gap:1rem}.cards{display:grid;gap:.7rem;margin-top:1rem}.card{border:1px solid #cad7cf;border-radius:1rem;background:#fff;padding:1rem}.gamegrid{display:grid;gap:.7rem}.date{font-weight:900}.time,.meta{margin:.15rem 0 0;color:#627068;font-size:.86rem}.match{font-weight:800}.score{font-size:1.35rem;font-weight:950;font-variant-numeric:tabular-nums}.badge{display:inline-flex;width:max-content;border-radius:999px;background:#e9f0eb;padding:.35rem .65rem;color:#405149;font-size:.76rem;font-weight:900}.rain{background:#fff0cf;color:#664900}.updated{background:#e7f0ff;color:#163e72}.sidebar{display:grid;gap:1rem;align-content:start}.panel{border:1px solid #cad7cf;border-radius:1rem;background:#fff;padding:1rem}.panel p{line-height:1.55}.directions{display:flex;min-height:2.7rem;margin-top:.8rem;align-items:center;justify-content:center;border:1px solid #0f5138;border-radius:.6rem;color:#0f5138;font-size:.86rem;font-weight:900;text-decoration:none}.race-list{list-style:none;margin:.8rem 0 0;padding:0}.race-row{border-top:1px solid #edf1ee;padding:.8rem 0}.race-row.selected{margin-inline:-.45rem;border-radius:.75rem;background:#fff7df;padding-inline:.45rem}.race-head,.race-team{display:flex;align-items:flex-start}.race-head{justify-content:space-between;gap:.7rem}.race-team{min-width:0;gap:.5rem}.race-rank{width:1.25rem;flex:0 0 auto;color:#829087;font-size:.78rem;font-weight:900}.race-name{display:block;overflow-wrap:anywhere;font-size:.88rem;font-weight:900}.race-meta,.team-focus{display:block;margin-top:.15rem;color:#627068;font-size:.72rem;line-height:1.4}.team-focus{display:none;color:#7a5310;font-weight:900}.race-row.selected .team-focus{display:block}.race-points{flex:0 0 auto;font-size:.82rem;font-weight:950;font-variant-numeric:tabular-nums}.race-trackbox{position:relative;height:2.5rem;margin:.25rem 1.15rem 0}.race-line,.race-fill{position:absolute;top:50%;left:0;height:4px;transform:translateY(-50%);border-radius:999px}.race-line{right:0;background:#dfe7e1}.race-fill{width:var(--race-position);background:#0f6a48}.race-mid{position:absolute;top:.45rem;bottom:.45rem;left:50%;width:1px;background:#cad7cf}.race-dot{position:absolute;top:50%;left:var(--race-position);display:grid;width:2.15rem;height:2.15rem;place-items:center;transform:translate(-50%,-50%);border:4px solid #fff;border-radius:50%;background:#10231c;color:#fff;font-size:.7rem;font-weight:950;font-variant-numeric:tabular-nums}.race-row.selected .race-fill{background:#d89a1d}.race-row.selected .race-dot{border-color:#fff1c7;background:#f4b942;color:#10231c}.race-axis{display:flex;justify-content:space-between;margin:0 1.15rem;color:#627068;font-size:.7rem;font-weight:800;font-variant-numeric:tabular-nums}.race-axis-title{margin:-.85rem 0 0!important;text-align:center;color:#627068;font-size:.7rem}.standings-details{margin-top:1rem;border-top:1px solid #e1e8e3}.standings-details summary{display:flex;min-height:2.75rem;cursor:pointer;align-items:center;color:#0f5138;font-size:.82rem;font-weight:900}.standings{width:100%;margin-top:.2rem;border-collapse:collapse;font-size:.82rem}.standings th,.standings td{border-top:1px solid #e1e8e3;padding:.65rem .35rem;text-align:right;font-variant-numeric:tabular-nums}.standings th:first-child,.standings td:first-child{text-align:left}.empty{margin-top:1rem;border:1px dashed #9eafa3;border-radius:1rem;background:#fff;padding:2rem 1rem;text-align:center;color:#627068}.foot{border-top:1px solid #d9e2dc;padding:1.5rem 0;color:#627068;font-size:.8rem}.hidden{display:none!important}@media(min-width:640px){.gamegrid{grid-template-columns:9rem minmax(0,1fr) auto;align-items:center}.herobody{padding:1.8rem}}@media(min-width:900px){.layout{grid-template-columns:minmax(0,1.45fr) minmax(18rem,.7fr);align-items:start}.sidebar{position:sticky;top:1rem}}@media print{.toolbar,.offline{display:none}.main{padding-top:1rem}.hero{box-shadow:none}.shell{width:100%}}
${RACE_POSITION_CSS}
`;

const SNAPSHOT_SCRIPT = String.raw`(()=>{const s=document.getElementById("team-filter"),cards=[...document.querySelectorAll("[data-game]")],race=[...document.querySelectorAll("[data-race-team]")],empty=document.getElementById("filtered-empty");if(!s)return;const fromHash=()=>{const p=new URLSearchParams(location.hash.slice(1));return p.get("team")||""};const apply=()=>{const value=s.value;let shown=0;for(const card of cards){const teams=(card.getAttribute("data-teams")||"").split(" ");const visible=!value||teams.includes(value);card.classList.toggle("hidden",!visible);if(visible)shown++}for(const row of race)row.classList.toggle("selected",Boolean(value)&&row.getAttribute("data-race-team")===value);if(empty)empty.classList.toggle("hidden",shown>0);const next=value?"team="+encodeURIComponent(value):"";if(location.hash.slice(1)!==next)history.replaceState(null,"",next?"#"+next:location.pathname+location.search)};const initial=fromHash();if(initial&&[...s.options].some(o=>o.value===initial))s.value=initial;s.addEventListener("change",apply);apply()})();`;

export async function generatePublicLeagueHtml(
  input: LeagueDocumentV1,
): Promise<string> {
  const document = assertPortableDocument(input);
  if (document.export.scope !== "public-snapshot") {
    throw new Error("Public HTML requires a validated public-snapshot document.");
  }
  if (document.privateData || document.teamPacket || document.sync) {
    throw new Error("Public HTML cannot contain private or synchronization data.");
  }

  const now = new Date(document.export.exportedAt);
  const gameViews = sortedGames(document.games).map((game) => ({
    game,
    state: classifyGameState(gameForState(game, document), document.league.schedule.durationMinutes, now),
  }));
  const resultByGame = new Map(
    document.results.map((result) => [result.gameId, result]),
  );
  const teamById = new Map(document.teams.map((team) => [team.id, team.name]));
  const future = gameViews.filter(({ state }) =>
    ["in-progress", "rescheduled", "scheduled"].includes(state),
  );
  const updates = gameViews.filter(({ state }) =>
    ["rained-out", "result-pending", "tbd"].includes(state),
  );
  const finals = gameViews
    .filter(({ state }) => state === "final")
    .sort(
      (left, right) =>
        Date.parse(resultByGame.get(right.game.id)?.updatedAt ?? "1970-01-01T00:00:00Z") -
        Date.parse(resultByGame.get(left.game.id)?.updatedAt ?? "1970-01-01T00:00:00Z"),
    );
  const hero = buildHero(future, updates, document, teamById);
  const standings = buildStandings(
    document.teams,
    document.games.map((game) => ({
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      result: resultByGame.get(game.id) ?? null,
      status: game.status,
    })),
    document.league.scoring,
  );
  const scoreLabels = getScoreLabels(document.league.sport);
  const [styleHash, scriptHash] = await Promise.all([
    sha256(SNAPSHOT_CSS),
    sha256(SNAPSHOT_SCRIPT),
  ]);
  const csp = [
    "default-src 'none'",
    "connect-src 'none'",
    "img-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="${escapeDoubleQuotedAttribute(csp)}">
  <meta name="referrer" content="no-referrer">
  <title>${escapeText(document.league.name)} · League snapshot</title>
  <style>${SNAPSHOT_CSS}</style>
</head>
<body>
  <header class="top"><div class="shell topin"><div class="brand"><span class="logo">RL</span><span>Rec League</span></div><span class="offline">Saved offline snapshot</span></div></header>
  <main class="shell main">
    <section>
      <p class="eyebrow">Public family page</p>
      <h1>${escapeText(document.league.name)}</h1>
      <p class="sub">${escapeText([document.league.sport, document.league.seasonLabel].filter(Boolean).join(" · ") || "League schedule and results")}</p>
    </section>
    ${document.league.archivedAt ? `<p class="notice"><strong>Season archived.</strong> This saved page remains available for schedule and result history.</p>` : ""}
    <section class="toolbar">
      <label>Show one team<select id="team-filter"><option value="">All teams</option>${document.teams.map((team) => `<option value="${escapeAttribute(team.id)}">${escapeText(team.name)}</option>`).join("")}</select></label>
      <p class="fresh">Public data updated ${escapeText(formatDateTime(document.league.publicUpdatedAt, document.league.timeZone))}<br>Snapshot saved ${escapeText(formatDateTime(document.export.exportedAt, document.league.timeZone))}</p>
    </section>
    <section class="hero"><div class="herohead">${escapeText(hero.eyebrow)}</div><div class="herobody"><h2>${escapeText(hero.title)}</h2><p>${escapeText(hero.copy)}</p></div></section>
    <div class="layout">
      <div>
        ${gameSection("Schedule updates", updates, document, teamById, resultByGame)}
        ${gameSection("Coming up", future, document, teamById, resultByGame)}
        ${gameSection("Official results", finals, document, teamById, resultByGame)}
        <p class="empty hidden" id="filtered-empty">No games in this saved snapshot match that team.</p>
      </div>
      <aside class="sidebar">
        ${venuePanel(document)}
        ${document.league.scoring.showStandings ? standingsPanel(standings, scoreLabels.scoreDiff, document) : ""}
      </aside>
    </div>
  </main>
  <footer class="foot"><div class="shell">Read-only offline snapshot · Revision ${document.dataRevision} · Times shown in ${escapeText(document.league.timeZone)}</div></footer>
  <script>${SNAPSHOT_SCRIPT}</script>
</body>
</html>\n`;
}

function gameSection(
  title: string,
  games: Array<{ game: PortableGame; state: PublicGameState }>,
  document: LeagueDocumentV1,
  teamById: Map<string, string>,
  resultByGame: Map<string, LeagueDocumentV1["results"][number]>,
): string {
  if (!games.length) return "";
  return `<section class="section"><div class="heading"><div><p class="eyebrow">League calendar</p><h2>${escapeText(title)}</h2></div><span class="count">${games.length}</span></div><div class="cards">${games
    .map(({ game, state }) => {
      const result = resultByGame.get(game.id);
      const label = stateLabel(state);
      return `<article class="card" data-game data-teams="${escapeAttribute(`${game.homeTeamId} ${game.awayTeamId}`)}"><div class="gamegrid"><div><p class="date">${escapeText(game.scheduled ? formatShortDate(game.scheduled.utc, document.league.timeZone) : "Date TBD")}</p><p class="time">${escapeText(game.scheduled ? formatTime(game.scheduled.utc, document.league.timeZone) : `Round ${game.round}`)}</p></div><div><p class="match">${escapeText(teamById.get(game.homeTeamId) ?? "Home team")} <span aria-hidden="true">vs</span> ${escapeText(teamById.get(game.awayTeamId) ?? "Away team")}</p><p class="meta">${escapeText([game.fieldName, document.league.venue.name].filter(Boolean).join(" · ") || "Field TBD")}</p></div>${result ? `<p class="score" aria-label="Final score ${result.homeScore} to ${result.awayScore}">${result.homeScore}–${result.awayScore}</p>` : `<span class="badge ${state === "rained-out" ? "rain" : state === "rescheduled" ? "updated" : ""}">${escapeText(label)}</span>`}</div></article>`;
    })
    .join("")}</div></section>`;
}

function venuePanel(document: LeagueDocumentV1): string {
  const venue = document.league.venue;
  const directionUrl = safeDirectionsUrl(venue.url, venue.address);
  return `<section class="panel"><p class="eyebrow">Game-day details</p><h2>${escapeText(venue.name ?? "League venue")}</h2><p class="meta">${escapeText(venue.address ?? "Field details appear with each game.")}</p>${directionUrl ? `<a class="directions" href="${escapeAttribute(directionUrl)}" rel="noreferrer noopener" target="_blank">Get directions ↗</a>` : ""}</section>`;
}

function standingsPanel(
  standings: ReturnType<typeof buildStandings>,
  differentialLabel: string,
  document: LeagueDocumentV1,
): string {
  const hasFinal = standings.some((row) => row.played > 0);
  const scoring = `${document.league.scoring.winPoints} for a win · ${document.league.scoring.tiePoints} for a tie · ${document.league.scoring.lossPoints} for a loss`;

  if (!hasFinal) {
    return `<section class="panel"><p class="eyebrow">League race</p><h2>Standings</h2><p class="meta">${escapeText(scoring)}</p><p class="meta">Standings begin after the first official final.</p></section>`;
  }

  const axisMaximum = Math.max(1, ...standings.map((row) => row.points));
  const raceRows = standings
    .map((row, index) => {
      const position = Math.round(
        Math.min(100, Math.max(0, (row.points / axisMaximum) * 100)),
      );
      return `<li class="race-row" data-race-team="${escapeAttribute(row.teamId)}"><div class="race-head"><div class="race-team"><span class="race-rank">${index + 1}</span><span><span class="race-name">${escapeText(row.teamName)}</span><span class="race-meta">${row.wins}W · ${row.losses}L · ${row.ties}T · ${escapeText(differentialLabel)} ${signedNumber(row.goalDifferential)}</span><span class="team-focus">Your team</span></span></div><span class="race-points">${row.points} pts</span></div><div aria-hidden="true" class="race-trackbox race-position-${position}"><span class="race-line"></span><span class="race-mid"></span><span class="race-fill"></span><span class="race-dot">${row.points}</span></div></li>`;
    })
    .join("");
  const tableRows = standings
    .map(
      (row) =>
        `<tr><td>${escapeText(row.teamName)}</td><td>${row.played}</td><td><strong>${row.points}</strong></td><td>${signedNumber(row.goalDifferential)}</td></tr>`,
    )
    .join("");

  return `<section class="panel"><p class="eyebrow">League race</p><h2>Standings</h2><p class="meta">${escapeText(scoring)}</p><figure class="race"><figcaption hidden>Teams are ordered by official rank. Marker position shows league points from zero to ${axisMaximum}.</figcaption><ol aria-label="League standings plotted by points" class="race-list">${raceRows}</ol><div aria-hidden="true" class="race-axis"><span>0</span><span>${axisMaximum}</span></div><p aria-hidden="true" class="race-axis-title">League points</p></figure><details class="standings-details"><summary>Full standings table</summary><table class="standings"><thead><tr><th>Team</th><th>GP</th><th>Pts</th><th>${escapeText(differentialLabel)}</th></tr></thead><tbody>${tableRows}</tbody></table></details></section>`;
}

function buildHero(
  future: Array<{ game: PortableGame; state: PublicGameState }>,
  updates: Array<{ game: PortableGame; state: PublicGameState }>,
  document: LeagueDocumentV1,
  teamById: Map<string, string>,
) {
  if (document.league.archivedAt) {
    return { copy: "This saved season is read-only.", eyebrow: "Season status", title: "Season archived" };
  }
  const next = future[0];
  if (next) {
    return {
      copy: `${teamById.get(next.game.homeTeamId)} vs ${teamById.get(next.game.awayTeamId)}${next.game.fieldName ? ` · ${next.game.fieldName}` : ""}`,
      eyebrow: next.state === "in-progress" ? "Playing now" : "Next game",
      title: next.game.scheduled
        ? formatDateTime(next.game.scheduled.utc, document.league.timeZone)
        : "Date to be announced",
    };
  }
  if (updates.length) {
    return { copy: "Check the schedule updates below.", eyebrow: "League update", title: stateLabel(updates[0].state) };
  }
  return document.games.length
    ? { copy: "All scheduled games have results.", eyebrow: "Season status", title: "Season complete" }
    : { copy: "The organizer has not published games yet.", eyebrow: "League schedule", title: "Schedule coming soon" };
}

function gameForState(game: PortableGame, document: LeagueDocumentV1) {
  const result = document.results.find((candidate) => candidate.gameId === game.id);
  return {
    ...game,
    result: result
      ? { awayScore: result.awayScore, homeScore: result.homeScore }
      : null,
    scheduledAt: game.scheduled ? new Date(game.scheduled.utc) : null,
  };
}

function sortedGames(games: PortableGame[]): PortableGame[] {
  return [...games].sort((left, right) => {
    if (left.scheduled && right.scheduled) {
      return Date.parse(left.scheduled.utc) - Date.parse(right.scheduled.utc);
    }
    if (left.scheduled) return -1;
    if (right.scheduled) return 1;
    return left.round - right.round || left.id.localeCompare(right.id);
  });
}

function stateLabel(state: PublicGameState): string {
  return {
    final: "Final",
    "in-progress": "Playing now",
    "rained-out": "Rained out",
    rescheduled: "Updated",
    "result-pending": "Result pending",
    scheduled: "Scheduled",
    tbd: "Date TBD",
  }[state];
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatShortDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function safeDirectionsUrl(url: string | null, address: string | null): string | null {
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // Fall through to the public address search.
    }
  }
  return address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeDoubleQuotedAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot create a secure offline snapshot.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
