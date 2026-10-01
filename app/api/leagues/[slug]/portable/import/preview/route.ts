import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  MAX_PORTABLE_JSON_BYTES,
  PortableDocumentValidationError,
  parsePortableDocumentBytes,
  serializePortableDocument,
} from "@/lib/portable";
import { summarizeCreateCopy } from "@/lib/portable-server/import-copy";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  if (
    !isSameOriginMutation(
      request,
      request.nextUrl.origin,
      configuredOrigin(),
    )
  ) {
    return jsonError("This import request did not come from this site.", 403);
  }
  if (!isJsonUpload(request.headers.get("content-type"))) {
    return jsonError("Choose a .rec-league.json file.", 415);
  }

  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const allowed = await consumeRateLimit("portable-import", [
      {
        identifier: `league:${authorization.leagueId}`,
        limit: 30,
        windowMs: 60 * 60 * 1_000,
      },
      {
        identifier: `email:${authorization.email}`,
        limit: 20,
        windowMs: 60 * 60 * 1_000,
      },
    ]);
    if (!allowed) {
      return jsonError("Too many backup previews. Try again later.", 429);
    }
    const bytes = await readBoundedRequestBody(request, MAX_PORTABLE_JSON_BYTES);
    const document = parsePortableDocumentBytes(bytes);
    if (document.export.scope !== "organizer-backup" || !document.privateData) {
      return jsonError("Only a complete organizer backup can create a copy.", 422);
    }

    const sourceJson = serializePortableDocument(document);
    const sourceHash = createHash("sha256").update(sourceJson).digest("hex");
    const summary = summarizeCreateCopy(document);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);
    const preview = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        const league = await tx.league.findUnique({
          where: { id: authorization.leagueId },
          select: { dataRevision: true },
        });
        if (!league) throw new AuthorizationError();
        await tx.importPreview.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              {
                leagueId: authorization.leagueId,
                mode: "CREATE_COPY",
                organizerEmail: authorization.email,
              },
            ],
          },
        });
        return tx.importPreview.create({
          data: {
            expectedRevision: league.dataRevision,
            expiresAt,
            leagueId: authorization.leagueId,
            mode: "CREATE_COPY",
            organizerEmail: authorization.email,
            sourceHash,
            sourceJson,
            summaryJson: JSON.stringify(summary),
          },
          select: { id: true },
        });
      },
      { isolationLevel: "Serializable" },
    );

    return privateJson({
      currentBackupUrl: `/api/leagues/${encodeURIComponent(slug)}/portable`,
      expiresAt: expiresAt.toISOString(),
      previewId: preview.id,
      sourceHash,
      summary,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof PortableDocumentValidationError) {
      return privateJson({ error: "The file is not a valid portable league backup.", issues: error.issues }, 422);
    }
    console.error("Could not preview portable league import.", error);
    return jsonError("The backup could not be previewed.", 500);
  }
}

function isJsonUpload(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0].trim().toLocaleLowerCase();
  return (
    mediaType === "application/json" ||
    mediaType === "application/octet-stream" ||
    mediaType === "application/vnd.gameology.rec-league+json"
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
