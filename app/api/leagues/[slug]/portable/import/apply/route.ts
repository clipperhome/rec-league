import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  AuthorizationError,
  assertOrganizerInTransaction,
  requireCommissionerForLeague,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePortableDocument, parseStrictJson } from "@/lib/portable";
import { createLeagueCopyFromDocument } from "@/lib/portable-server/import-copy";
import {
  RequestBodyError,
  isSameOriginMutation,
  readBoundedRequestBody,
} from "@/lib/request-security";

const APPLY_BODY_LIMIT = 16 * 1024;
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

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
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return jsonError("Send a JSON confirmation.", 415);
  }

  const { slug } = await context.params;
  try {
    const authorization = await requireCommissionerForLeague(slug, {
      allowArchived: true,
      requireVerified: true,
    });
    const bytes = await readBoundedRequestBody(request, APPLY_BODY_LIMIT);
    const value = parseStrictJsonBytesForApply(bytes);
    const previewId = readPreviewId(value);
    const copied = await db.$transaction(
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
            mode: "CREATE_COPY",
            organizerEmail: authorization.email,
          },
        });
        if (!preview) throw new ImportApplyError("PREVIEW_EXPIRED");

        const anchor = await tx.league.findUnique({
          where: { id: authorization.leagueId },
          select: { dataRevision: true },
        });
        if (!anchor || anchor.dataRevision !== preview.expectedRevision) {
          throw new ImportApplyError("STALE_PREVIEW");
        }
        const sourceHash = createHash("sha256")
          .update(preview.sourceJson)
          .digest("hex");
        if (sourceHash !== preview.sourceHash) {
          throw new ImportApplyError("PREVIEW_TAMPERED");
        }

        const document = parsePortableDocument(preview.sourceJson);
        const created = await createLeagueCopyFromDocument(
          tx,
          document,
          authorization.email,
        );
        await tx.importPreview.delete({ where: { id: preview.id } });
        return created;
      },
      { isolationLevel: "Serializable" },
    );

    return privateJson({
      leagueId: copied.id,
      redirectUrl: `/dashboard/${encodeURIComponent(copied.slug)}?notice=${encodeURIComponent("League copy created from portable backup.")}&tone=success`,
      slug: copied.slug,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError("Not authorized.", 401);
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof ImportApplyError) {
      const messages = {
        PREVIEW_EXPIRED: "That import preview expired. Choose the file again.",
        PREVIEW_TAMPERED: "The stored preview no longer matches the validated file.",
        STALE_PREVIEW: "The league changed after this preview. Review the file again before importing.",
      } as const;
      return jsonError(messages[error.code], error.code === "STALE_PREVIEW" ? 409 : 422);
    }
    console.error("Could not apply portable league import.", error);
    return jsonError("The league copy could not be created. No partial copy was kept.", 500);
  }
}

class ImportApplyError extends Error {
  constructor(
    readonly code: "PREVIEW_EXPIRED" | "PREVIEW_TAMPERED" | "STALE_PREVIEW",
  ) {
    super(code);
    this.name = "ImportApplyError";
  }
}

function parseStrictJsonBytesForApply(bytes: Uint8Array): unknown {
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
    throw new RequestBodyError(400, "Choose a valid import preview.");
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
