import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { serializePortableDocument } from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import { planServerPortableOperations } from "@/lib/portable-server/reconcile-plan";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";
import {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  SpreadsheetImportError,
  describeSpreadsheetChanges,
  workbookToConnectedDocument,
} from "@/lib/spreadsheet/league-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  if (!isSameOriginMutation(request, request.nextUrl.origin, configuredOrigin())) {
    return jsonError("This spreadsheet request did not come from this site.", 403);
  }
  if (!isWorkbookUpload(request.headers.get("content-type"))) {
    return jsonError("Choose an .xlsx workbook exported by this league.", 415);
  }

  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const allowed = await consumeRateLimit("portable-reconcile", [
      {
        identifier: `league:${authorization.leagueId}:spreadsheet`,
        limit: 30,
        windowMs: 60 * 60 * 1_000,
      },
      {
        identifier: `email:${authorization.email}:spreadsheet`,
        limit: 20,
        windowMs: 60 * 60 * 1_000,
      },
    ]);
    if (!allowed) {
      return jsonError("Too many spreadsheet previews. Try again later.", 429);
    }
    const bytes = await readBoundedRequestBody(
      request,
      MAX_SPREADSHEET_UPLOAD_BYTES,
    );
    const snapshot = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        return buildOrganizerLeagueDocument(tx, authorization.leagueId);
      },
      { isolationLevel: "Serializable" },
    );
    const imported = await workbookToConnectedDocument(bytes, snapshot);
    const changes = describeSpreadsheetChanges(snapshot, imported.document);
    const sourceJson = serializePortableDocument(imported.document);
    const sourceHash = createHash("sha256").update(sourceJson).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);

    const result = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        const current = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        if (current.dataRevision !== snapshot.dataRevision) {
          throw new SpreadsheetPreviewError(
            "The connected league changed while the workbook was being checked. Preview it again.",
          );
        }
        const plan = await planServerPortableOperations(
          tx,
          authorization.leagueId,
          current,
          imported.document,
          { email: authorization.email, role: "ORGANIZER" },
        );
        await tx.importPreview.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              {
                leagueId: authorization.leagueId,
                mode: "SPREADSHEET",
                organizerEmail: authorization.email,
              },
            ],
          },
        });
        const preview = await tx.importPreview.create({
          data: {
            expectedRevision: current.dataRevision,
            expiresAt,
            leagueId: authorization.leagueId,
            mode: "SPREADSHEET",
            organizerEmail: authorization.email,
            sourceHash,
            sourceJson,
            summaryJson: JSON.stringify({
              changes,
              plan,
              warnings: imported.warnings,
            }),
          },
          select: { id: true },
        });
        return { plan, previewId: preview.id };
      },
      { isolationLevel: "Serializable" },
    );

    return privateJson({
      changes,
      expiresAt: expiresAt.toISOString(),
      plan: result.plan,
      previewId: result.previewId,
      sourceHash,
      warnings: imported.warnings,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof SpreadsheetImportError) {
      return privateJson(
        { error: "The workbook could not be validated.", issues: error.issues },
        422,
      );
    }
    if (error instanceof SpreadsheetPreviewError) return jsonError(error.message, 409);
    console.error("Could not preview the league workbook.", error);
    return jsonError("The workbook could not be previewed.", 500);
  }
}

class SpreadsheetPreviewError extends Error {}

function isWorkbookUpload(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0].trim().toLocaleLowerCase();
  return (
    mediaType === "application/octet-stream" ||
    mediaType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function configuredOrigin(): string | undefined {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    return undefined;
  }
}

function jsonError(message: string, status: number): NextResponse {
  return privateJson({ error: message }, status);
}

function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}
