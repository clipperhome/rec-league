import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertTeamAccessInTransaction,
  getTeamManagerAuthorization,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertPortableDocument,
  parsePortableDocument,
  parseStrictJson,
  portableOperationTarget,
  projectTeamManagerPacket,
  type LeagueDocumentV1,
  type PortableOperation,
  type PortableSyncPreviewStatus,
} from "@/lib/portable";
import {
  ApplyOperationError,
  applyPortableOperation,
} from "@/lib/portable-server/apply-operation";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import { planServerPortableOperations } from "@/lib/portable-server/reconcile-plan";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";

const APPLY_BODY_LIMIT = 16 * 1024;
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

type AppliedItem = {
  kind: PortableOperation["kind"];
  message: string;
  operationId: string;
  replayed?: boolean;
  status: "applied" | Exclude<PortableSyncPreviewStatus, "ready">;
};

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  if (!isSameOriginMutation(request, request.nextUrl.origin, configuredOrigin())) {
    return jsonError("This sync request did not come from this site.", 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return jsonError("Send a JSON confirmation.", 415);
  }

  const { teamId } = await context.params;
  try {
    const authorization = await getTeamManagerAuthorization(teamId, {
      allowArchived: true,
    });
    if (!authorization || authorization.isCommissioner) {
      throw new AuthorizationError();
    }
    const previewId = readPreviewId(
      parseApplyBody(await readBoundedRequestBody(request, APPLY_BODY_LIMIT)),
    );
    const guarded = await db.$transaction(
      async (tx) => {
        await assertTeamAccessInTransaction(tx, authorization, {
          allowArchived: true,
        });
        const preview = await tx.importPreview.findFirst({
          where: {
            expiresAt: { gt: new Date() },
            id: previewId,
            leagueId: authorization.leagueId,
            mode: `TEAM_RECONCILE:${teamId}`,
            organizerEmail: authorization.email,
          },
        });
        if (!preview) throw new ManagerApplyError("PREVIEW_EXPIRED");
        if (
          createHash("sha256").update(preview.sourceJson).digest("hex") !==
          preview.sourceHash
        ) {
          throw new ManagerApplyError("PREVIEW_TAMPERED");
        }
        const incoming = parsePortableDocument(preview.sourceJson);
        const organizerDocument = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        const current = projectTeamManagerPacket(organizerDocument, teamId);
        if (current.dataRevision !== preview.expectedRevision) {
          throw new ManagerApplyError("STALE_PREVIEW");
        }
        const plan = await planServerPortableOperations(
          tx,
          authorization.leagueId,
          current,
          incoming,
          { email: authorization.email, role: "MANAGER", teamId },
        );
        const consumed = await tx.importPreview.deleteMany({
          where: { id: preview.id },
        });
        if (consumed.count !== 1) throw new ManagerApplyError("PREVIEW_EXPIRED");
        return { incoming, plan };
      },
      { isolationLevel: "Serializable" },
    );

    const operations = guarded.incoming.sync?.pendingOperations ?? [];
    const results: AppliedItem[] = [];
    const failedTargets = new Set<string>();
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const previewItem = guarded.plan.items[index];
      const target = portableOperationTarget(operation);
      if (target && failedTargets.has(target)) {
        results.push({
          kind: operation.kind,
          message: "An earlier report for this game needs attention first.",
          operationId: operation.operationId,
          status: "blocked-by-dependency",
        });
        continue;
      }
      if (!previewItem || previewItem.status !== "ready") {
        const status =
          previewItem?.status === "blocked-by-dependency" ||
          previewItem?.status === "conflict" ||
          previewItem?.status === "rejected"
            ? previewItem.status
            : "rejected";
        results.push({
          kind: operation.kind,
          message: previewItem?.message ?? "The report could not be planned.",
          operationId: operation.operationId,
          status,
        });
        if (target) failedTargets.add(target);
        continue;
      }

      try {
        const applied = await applyPortableOperation(
          authorization.leagueId,
          {
            email: authorization.email,
            role: "MANAGER",
            teamId,
          },
          operation,
        );
        results.push({
          kind: operation.kind,
          message: applied.replayed
            ? "This report was already synchronized."
            : "Submitted for organizer review.",
          operationId: operation.operationId,
          replayed: applied.replayed,
          status: "applied",
        });
      } catch (error) {
        const normalized =
          error instanceof ApplyOperationError
            ? error
            : new ApplyOperationError(
                "rejected",
                "The report could not be synchronized safely.",
              );
        console.error("Could not apply one manager operation.", error);
        results.push({
          kind: operation.kind,
          message: normalized.message,
          operationId: operation.operationId,
          status: normalized.result,
        });
        if (target) failedTargets.add(target);
      }
    }

    const fresh = await db.$transaction(
      async (tx) => {
        await assertTeamAccessInTransaction(tx, authorization, {
          allowArchived: true,
        });
        const organizerDocument = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        return projectTeamManagerPacket(organizerDocument, teamId);
      },
      { isolationLevel: "Serializable" },
    );
    const failedIds = new Set(
      results
        .filter((result) => result.status !== "applied")
        .map((result) => result.operationId),
    );
    const reconciled = assertPortableDocument({
      ...fresh,
      sync: {
        clientId: guarded.incoming.sync!.clientId,
        lastSyncedRevision: fresh.dataRevision,
        mode: "connected",
        pendingOperations: operations.filter((operation) =>
          failedIds.has(operation.operationId),
        ),
      },
    } satisfies LeagueDocumentV1);

    return privateJson({
      document: reconciled,
      results,
      summary: {
        applied: results.filter((result) => result.status === "applied").length,
        blocked: results.filter(
          (result) => result.status === "blocked-by-dependency",
        ).length,
        conflicts: results.filter((result) => result.status === "conflict").length,
        rejected: results.filter((result) => result.status === "rejected").length,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof ManagerApplyError) {
      const messages = {
        PREVIEW_EXPIRED: "That preview expired. Choose the packet again.",
        PREVIEW_TAMPERED: "The stored preview no longer matches the packet.",
        STALE_PREVIEW: "The connected league changed. Review the packet again.",
      } as const;
      return jsonError(messages[error.code], error.code === "STALE_PREVIEW" ? 409 : 422);
    }
    console.error("Could not reconcile manager reports.", error);
    return jsonError("The manager reports could not be reconciled.", 500);
  }
}

class ManagerApplyError extends Error {
  constructor(
    readonly code: "PREVIEW_EXPIRED" | "PREVIEW_TAMPERED" | "STALE_PREVIEW",
  ) {
    super(code);
    this.name = "ManagerApplyError";
  }
}

function parseApplyBody(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError(400, "The confirmation is not valid UTF-8.");
  }
  try {
    return parseStrictJson(text, { maxBytes: APPLY_BODY_LIMIT, maxDepth: 4 });
  } catch {
    throw new RequestBodyError(400, "The confirmation is not valid JSON.");
  }
}

function readPreviewId(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { previewId?: unknown }).previewId !== "string" ||
    !PREVIEW_ID_PATTERN.test((value as { previewId: string }).previewId)
  ) {
    throw new RequestBodyError(400, "Choose a valid report preview.");
  }
  return (value as { previewId: string }).previewId;
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
