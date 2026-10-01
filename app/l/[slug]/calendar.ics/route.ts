import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildLeagueCalendar } from "@/lib/ics";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  const requestedTeamId = request.nextUrl.searchParams.get("team");
  const league = await db.league.findUnique({
    where: { slug },
    select: {
      gameDurationMinutes: true,
      games: {
        where: { scheduledAt: { not: null } },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        select: {
          awayTeam: { select: { name: true, updatedAt: true } },
          awayTeamId: true,
          fieldName: true,
          homeTeam: { select: { name: true, updatedAt: true } },
          homeTeamId: true,
          id: true,
          scheduledAt: true,
          status: true,
          updatedAt: true,
        },
      },
      name: true,
      slug: true,
      teams: { select: { id: true, name: true, updatedAt: true } },
      publicUpdatedAt: true,
      venueAddress: true,
      venueName: true,
    },
  });

  if (!league) return new NextResponse("Calendar not found.", { status: 404 });
  const selectedTeam = requestedTeamId
    ? league.teams.find((team) => team.id === requestedTeamId)
    : null;
  if (requestedTeamId && !selectedTeam) {
    return new NextResponse("Calendar not found.", { status: 404 });
  }

  const games = league.games.filter(
    (game) =>
      !requestedTeamId ||
      game.homeTeamId === requestedTeamId ||
      game.awayTeamId === requestedTeamId,
  );
  const publicUrl = new URL(`/l/${encodeURIComponent(slug)}`, request.nextUrl.origin);
  if (requestedTeamId) publicUrl.searchParams.set("team", requestedTeamId);
  const calendar = buildLeagueCalendar({
    durationMinutes: league.gameDurationMinutes,
    games: games.map((game) => ({
      awayTeamName: game.awayTeam.name,
      fieldName: game.fieldName,
      homeTeamName: game.homeTeam.name,
      id: game.id,
      scheduledAt: game.scheduledAt!,
      status: game.status,
      updatedAt: latestDate(
        game.updatedAt,
        game.homeTeam.updatedAt,
        game.awayTeam.updatedAt,
        league.publicUpdatedAt,
      ),
    })),
    leagueName: selectedTeam
      ? `${selectedTeam.name} · ${league.name}`
      : league.name,
    publicUrl: publicUrl.toString(),
    venueAddress: league.venueAddress,
    venueName: league.venueName,
  });
  const fileBase = `${selectedTeam?.name ?? league.name}-calendar`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "league-calendar";

  return new NextResponse(calendar, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${fileBase}.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function latestDate(...values: Date[]): Date {
  return new Date(Math.max(...values.map((value) => value.getTime())));
}
