import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertTeamAccessInTransaction,
  getTeamManagerAuthorization,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  MAX_PORTABLE_JSON_BYTES,
  PortableDocumentValidationError,
  parsePortableDocumentBytes,
  projectTeamManagerPacket,
  serializePortableDocument,
} from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import { planServerPortableOperations } from "@/lib/portable-server/reconcile-plan";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  if (!isSameOriginMutation(request, request.nextUrl.origin, configuredOrigin())) {
    return jsonError("This sync request did not come from this site.", 403);
  }
  if (!isJsonUpload(request.headers.get("content-type"))) {
    return jsonError("Choose a connected team packet.", 415);
  }

  const { teamId } = await context.params;
  try {
    const authorization = await getTeamManagerAuthorization(teamId, {
      allowArchived: true,
    });
    if (!authorization || authorization.isCommissioner) {
      throw new AuthorizationError();
    }
    const allowed = await consumeRateLimit("portable-reconcile", [
      {
        identifier: `league:${authorization.leagueId}`,
        limit: 100,
        windowMs: 60 * 60 * 1_000,
      },
      {
        identifier: `email:${authorization.email}`,
        limit: 60,
        windowMs: 60 * 60 * 1_000,
      },
    ]);
    if (!allowed) {
      return jsonError("Too many reconciliation previews. Try again later.", 429);
    }
    const bytes = await readBoundedRequestBody(request, MAX_PORTABLE_JSON_BYTES);
    const incoming = parsePortableDocumentBytes(bytes);
    if (
      incoming.export.scope !== "team-manager-packet" ||
      incoming.teamPacket?.teamId !== teamId ||
      !incoming.sync ||
      incoming.sync.mode !== "connected"
    ) {
      return jsonError("This file is not a connected packet for this team.", 422);
    }
    if (!incoming.sync.pendingOperations.length) {
      return jsonError("This packet has no reports waiting to synchronize.", 422);
    }

    const sourceJson = serializePortableDocument(incoming);
    const sourceHash = createHash("sha256").update(sourceJson).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);
    const result = await db.$transaction(
      async (tx) => {
        await assertTeamAccessInTransaction(tx, authorization, {
          allowArchived: true,
        });
        const organizerDocument = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        const current = projectTeamManagerPacket(organizerDocument, teamId);
        if (incoming.documentId !== current.documentId) {
          throw new ManagerPreviewError(
            "The selected packet belongs to a different league.",
          );
        }
        const plan = await planServerPortableOperations(
          tx,
          authorization.leagueId,
          current,
          incoming,
          { email: authorization.email, role: "MANAGER", teamId },
        );
        await tx.importPreview.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              {
                leagueId: authorization.leagueId,
                mode: `TEAM_RECONCILE:${teamId}`,
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
            mode: `TEAM_RECONCILE:${teamId}`,
            organizerEmail: authorization.email,
            sourceHash,
            sourceJson,
            summaryJson: JSON.stringify(plan),
          },
          select: { id: true },
        });
        return { plan, previewId: preview.id };
      },
      { isolationLevel: "Serializable" },
    );

    return privateJson({
      expiresAt: expiresAt.toISOString(),
      plan: result.plan,
      previewId: result.previewId,
      sourceHash,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof PortableDocumentValidationError) {
      return privateJson(
        { error: "The packet is not valid.", issues: error.issues },
        422,
      );
    }
    if (error instanceof ManagerPreviewError) return jsonError(error.message, 422);
    console.error("Could not preview manager reconciliation.", error);
    return jsonError("The team reports could not be previewed.", 500);
  }
}

class ManagerPreviewError extends Error {}

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
