import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  projectPublicSnapshot,
  projectSpreadsheetOperations,
  projectTeamManagerPacket,
  serializePortableDocument,
  type LeagueDocumentV1,
  type PortableExportScope,
} from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  const requestedScope = request.nextUrl.searchParams.get("scope") ??
    "organizer-backup";
  if (!isExportScope(requestedScope)) {
    return jsonError("Unsupported export scope.", 400);
  }

  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const exportedAt = new Date();
    const organizerDocument = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        return buildOrganizerLeagueDocument(tx, authorization.leagueId, {
          exportedAt,
        });
      },
      { isolationLevel: "Serializable" },
    );
    const document = selectProjection(
      organizerDocument,
      requestedScope,
      request.nextUrl.searchParams.get("teamId"),
      exportedAt,
    );
    const body = serializePortableDocument(document);
    const suffix =
      requestedScope === "organizer-backup"
        ? "backup"
        : requestedScope === "team-manager-packet"
          ? "team"
          : requestedScope === "spreadsheet-operations"
            ? "operations"
            : "public";
    const fileBase = safeFileBase(document.league.slug);

    return new NextResponse(body, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="${fileBase}.${suffix}.rec-league.json"`,
        "Content-Type": "application/vnd.gameology.rec-league+json; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError("Not authorized.", 401);
    }
    if (error instanceof Error && error.message.includes("team")) {
      return jsonError("Choose a team in this league.", 400);
    }
    console.error("Could not export portable league data.", error);
    return jsonError("The league data could not be exported.", 500);
  }
}

function selectProjection(
  organizerDocument: LeagueDocumentV1,
  scope: PortableExportScope,
  teamId: string | null,
  exportedAt: Date,
): LeagueDocumentV1 {
  const metadata = { exportedAt: exportedAt.toISOString() };
  switch (scope) {
    case "organizer-backup":
      return {
        ...organizerDocument,
        sync: {
          clientId: `client_${randomUUID()}`,
          lastSyncedRevision: organizerDocument.dataRevision,
          mode: "connected",
          pendingOperations: [],
        },
      };
    case "public-snapshot":
      return projectPublicSnapshot(organizerDocument, metadata);
    case "spreadsheet-operations":
      return projectSpreadsheetOperations(organizerDocument, metadata);
    case "team-manager-packet":
      if (!teamId) throw new Error("A team is required for this export.");
      return projectTeamManagerPacket(organizerDocument, teamId, metadata);
  }
}

function isExportScope(value: string): value is PortableExportScope {
  return (
    value === "organizer-backup" ||
    value === "public-snapshot" ||
    value === "spreadsheet-operations" ||
    value === "team-manager-packet"
  );
}

function safeFileBase(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "league"
  );
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
      status,
    },
  );
}
