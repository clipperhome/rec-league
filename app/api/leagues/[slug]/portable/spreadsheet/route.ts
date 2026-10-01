import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import {
  buildLeagueCsv,
  buildLeagueWorkbook,
  type SpreadsheetCsvTable,
} from "@/lib/spreadsheet/league-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const format = request.nextUrl.searchParams.get("format") ?? "xlsx";
  const table = request.nextUrl.searchParams.get("table");
  if (format !== "xlsx" && format !== "csv") {
    return jsonError("Choose xlsx or csv format.", 400);
  }
  if (format === "csv" && !isCsvTable(table)) {
    return jsonError("Choose teams, games, results, or standings for CSV.", 400);
  }
  if (format === "xlsx" && table !== null) {
    return jsonError("The table option is available only for CSV exports.", 400);
  }

  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const exportedAt = new Date();
    const document = await db.$transaction(
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
    const fileBase = safeFileBase(document.league.slug);
    const commonHeaders = {
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    };

    if (format === "csv") {
      if (!isCsvTable(table)) return jsonError("Choose a CSV table.", 400);
      const csv = buildLeagueCsv(document, table);
      return new NextResponse(csv, {
        headers: {
          ...commonHeaders,
          "Content-Disposition":
            `attachment; filename="${fileBase}.${table}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    const workbook = await buildLeagueWorkbook(document);
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        ...commonHeaders,
        "Content-Disposition":
          `attachment; filename="${fileBase}.operations.xlsx"`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      console.error("Could not export the league workbook.", error);
    }
    return jsonError(
      error instanceof AuthorizationError
        ? "Not authorized."
        : "The spreadsheet could not be exported.",
      error instanceof AuthorizationError ? 401 : 500,
    );
  }
}

function isCsvTable(value: string | null): value is SpreadsheetCsvTable {
  return (
    value === "games" ||
    value === "results" ||
    value === "standings" ||
    value === "teams"
  );
}

function safeFileBase(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || "league"
  );
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
      status,
    },
  );
}
