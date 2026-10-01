import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  AuthorizationError,
  assertTeamAccessInTransaction,
  getTeamManagerAuthorization,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertPortableDocument,
  projectTeamManagerPacket,
  serializePortableDocument,
} from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  const { teamId } = await context.params;
  try {
    const authorization = await getTeamManagerAuthorization(teamId, {
      allowArchived: true,
    });
    if (!authorization) throw new AuthorizationError();
    const packet = await db.$transaction(
      async (tx) => {
        await assertTeamAccessInTransaction(tx, authorization, {
          allowArchived: true,
          allowOrganizer: true,
        });
        const organizerDocument = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        const projected = projectTeamManagerPacket(organizerDocument, teamId);
        return assertPortableDocument({
          ...projected,
          sync: {
            clientId: `client_${randomUUID()}`,
            lastSyncedRevision: projected.dataRevision,
            mode: "connected",
            pendingOperations: [],
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    const fileBase =
      packet.teams
        .find((team) => team.id === teamId)
        ?.name.toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "team";

    return new NextResponse(serializePortableDocument(packet), {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="${fileBase}.team.rec-league.json"`,
        "Content-Type": "application/vnd.gameology.rec-league+json; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: "Not authorized." },
        { headers: { "Cache-Control": "no-store" }, status: 401 },
      );
    }
    console.error("Could not export the team-manager packet.", error);
    return NextResponse.json(
      { error: "The team packet could not be created." },
      { headers: { "Cache-Control": "no-store" }, status: 500 },
    );
  }
}
