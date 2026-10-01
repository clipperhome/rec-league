import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePortableDocument, parseStrictJson } from "@/lib/portable";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";
import {
  SpreadsheetAtomicApplyError,
  applySpreadsheetOperationsAtomically,
} from "@/lib/spreadsheet/apply";

const APPLY_BODY_LIMIT = 16 * 1024;
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  if (!isSameOriginMutation(request, request.nextUrl.origin, configuredOrigin())) {
    return jsonError("This spreadsheet request did not come from this site.", 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return jsonError("Send a JSON confirmation.", 415);
  }

  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const previewId = readPreviewId(
      parseApplyBody(await readBoundedRequestBody(request, APPLY_BODY_LIMIT)),
    );
    const result = await db.$transaction(
      async (tx) => {
        await assertOrganizerInTransaction(tx, authorization, {
          allowArchived: true,
          requireVerified: true,
        });
        const preview = await tx.importPreview.findFirst({
          where: {
            expiresAt: { gt: new Date() },
            id: previewId,
            leagueId: authorization.leagueId,
            mode: "SPREADSHEET",
            organizerEmail: authorization.email,
          },
        });
        if (!preview) throw new SpreadsheetApplyError("PREVIEW_EXPIRED");
        const sourceHash = createHash("sha256")
          .update(preview.sourceJson)
          .digest("hex");
        if (sourceHash !== preview.sourceHash) {
          throw new SpreadsheetApplyError("PREVIEW_TAMPERED");
        }
        const incoming = parsePortableDocument(preview.sourceJson);
        const current = await buildOrganizerLeagueDocument(
          tx,
          authorization.leagueId,
        );
        if (current.dataRevision !== preview.expectedRevision) {
          throw new SpreadsheetApplyError("STALE_PREVIEW");
        }
        const applied = await applySpreadsheetOperationsAtomically(
          tx,
          authorization.leagueId,
          current,
          incoming,
          { email: authorization.email, role: "ORGANIZER" },
        );
        const consumed = await tx.importPreview.deleteMany({
          where: { id: preview.id },
        });
        if (consumed.count !== 1) {
          throw new SpreadsheetApplyError("PREVIEW_EXPIRED");
        }
        return {
          appliedCount: applied.appliedCount,
          dataRevision: applied.document.dataRevision,
        };
      },
      { isolationLevel: "Serializable" },
    );

    return privateJson({
      ...result,
      backupUrl: `/api/leagues/${encodeURIComponent(slug)}/portable?scope=organizer-backup`,
      workbookUrl: `/api/leagues/${encodeURIComponent(slug)}/portable/spreadsheet`,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof SpreadsheetAtomicApplyError) {
      return jsonError(error.message, 422);
    }
    if (error instanceof SpreadsheetApplyError) {
      const messages = {
        PREVIEW_EXPIRED: "That spreadsheet preview expired. Choose the workbook again.",
        PREVIEW_TAMPERED: "The stored preview no longer matches the validated workbook.",
        STALE_PREVIEW: "The connected league changed after this preview. Review the workbook again.",
      } as const;
      const status = error.code === "STALE_PREVIEW" ? 409 : 422;
      return jsonError(messages[error.code], status);
    }
    console.error("Could not apply the league workbook atomically.", error);
    return jsonError(
      "No spreadsheet changes were applied. The league changed or one operation could not be committed safely.",
      409,
    );
  }
}

class SpreadsheetApplyError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_EXPIRED"
      | "PREVIEW_TAMPERED"
      | "STALE_PREVIEW",
  ) {
    super(code);
    this.name = "SpreadsheetApplyError";
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
    throw new RequestBodyError(400, "Choose a valid spreadsheet preview.");
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
