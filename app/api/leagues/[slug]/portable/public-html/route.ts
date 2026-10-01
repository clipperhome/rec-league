import { NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  generatePublicLeagueHtml,
  projectPublicSnapshot,
} from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const exportedAt = new Date();
    const snapshot = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        const organizerDocument = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
          { exportedAt },
        );
        return projectPublicSnapshot(organizerDocument, {
          exportedAt: exportedAt.toISOString(),
        });
      },
      { isolationLevel: "Serializable" },
    );
    const html = await generatePublicLeagueHtml(snapshot);
    return new NextResponse(html, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="${safeFileBase(snapshot.league.slug)}.public.html"`,
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      console.error("Could not generate the public offline page.", error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof AuthorizationError
            ? "Not authorized."
            : "The public offline page could not be generated.",
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: error instanceof AuthorizationError ? 401 : 500,
      },
    );
  }
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
