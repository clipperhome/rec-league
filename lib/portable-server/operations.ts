import { createHash } from "node:crypto";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import { recordLeagueActivity } from "@/lib/league-activity";
import { serializeCanonicalJsonValue } from "@/lib/portable/canonical-json";
import type { PortableJsonValue } from "@/lib/portable/types";

export type PortableOperationActor =
  | { email: string; role: "ORGANIZER"; teamId?: never }
  | { email: string; role: "MANAGER"; teamId: string };

export type PortableOperationActivity = {
  gameId?: string | null;
  summary: string;
  teamId?: string | null;
  touchesPublicPage?: boolean;
  type: string;
};

export type PortableOperationExecution<T extends PortableJsonValue> = {
  outcome: T;
  replayed: boolean;
  revision: number;
};

export class PortableOperationError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_CONFLICT" | "NOT_AUTHORIZED" | "REVISION_AHEAD",
    message: string,
  ) {
    super(message);
    this.name = "PortableOperationError";
  }
}

export function hashPortableOperationPayload(
  operationType: string,
  payload: PortableJsonValue,
): string {
  return createHash("sha256")
    .update(serializeCanonicalJsonValue({ operationType, payload }))
    .digest("hex");
}

/**
 * Executes one connected-mode command inside the caller's Serializable
 * transaction. The caller still owns entity-specific CAS checks in `mutate`;
 * this coordinator owns current authorization, idempotency, the league cursor,
 * activity, and the stored retry outcome.
 */
export async function runIdempotentLeagueOperation<T extends PortableJsonValue>(
  tx: Prisma.TransactionClient,
  input: {
    actor: PortableOperationActor;
    activity: PortableOperationActivity;
    allowArchived?: boolean;
    baseRevision: number;
    leagueId: string;
    operationId: string;
    operationType: string;
    payload: PortableJsonValue;
  },
  mutate: () => Promise<T>,
): Promise<PortableOperationExecution<T>> {
  const normalizedEmail = input.actor.email.trim().toLocaleLowerCase();
  const league = await tx.league.findUnique({
    where: { id: input.leagueId },
    select: {
      archivedAt: true,
      commissionerEmail: true,
      dataRevision: true,
      teamManagers:
        input.actor.role === "MANAGER"
          ? {
              where: {
                acceptedAt: { not: null },
                email: normalizedEmail,
                teamId: input.actor.teamId,
              },
              select: { id: true },
              take: 1,
            }
          : false,
    },
  });

  const isAuthorized =
    league &&
    (input.actor.role === "ORGANIZER"
      ? league.commissionerEmail?.trim().toLocaleLowerCase() === normalizedEmail
      : league.teamManagers.length === 1);
  if (!isAuthorized) {
    throw new PortableOperationError(
      "NOT_AUTHORIZED",
      "The current account is not allowed to apply this operation.",
    );
  }
  const payloadHash = hashPortableOperationPayload(
    input.operationType,
    input.payload,
  );
  const existing = await tx.appliedOperation.findUnique({
    where: {
      leagueId_operationId: {
        leagueId: input.leagueId,
        operationId: input.operationId,
      },
    },
  });

  if (existing) {
    const sameActor =
      existing.actorRole === input.actor.role &&
      existing.actorEmail?.trim().toLocaleLowerCase() === normalizedEmail &&
      (existing.teamId ?? null) === (input.actor.teamId ?? null);
    if (existing.payloadHash !== payloadHash || !sameActor) {
      throw new PortableOperationError(
        "IDEMPOTENCY_CONFLICT",
        "This operation ID was already used for different content or by a different actor.",
      );
    }
    return {
      outcome: JSON.parse(existing.outcomeJson) as T,
      replayed: true,
      revision: existing.appliedRevision,
    };
  }

  if (input.baseRevision > league.dataRevision) {
    throw new PortableOperationError(
      "REVISION_AHEAD",
      "The operation was created from a league revision newer than the server.",
    );
  }

  if (league.archivedAt && input.allowArchived !== true) {
    throw new PortableOperationError(
      "NOT_AUTHORIZED",
      "Archived leagues cannot accept new operations.",
    );
  }

  const outcome = await mutate();
  const revision = await recordLeagueActivity(tx, {
    actorEmail: normalizedEmail,
    actorRole: input.actor.role,
    gameId: input.activity.gameId,
    leagueId: input.leagueId,
    operationId: input.operationId,
    summary: input.activity.summary,
    teamId: input.activity.teamId,
    touchesPublicPage: input.activity.touchesPublicPage,
    type: input.activity.type,
  });
  await tx.appliedOperation.create({
    data: {
      actorEmail: normalizedEmail,
      actorRole: input.actor.role,
      appliedRevision: revision,
      leagueId: input.leagueId,
      operationId: input.operationId,
      operationType: input.operationType,
      outcomeJson: serializeCanonicalJsonValue(outcome),
      payloadHash,
      teamId: input.actor.teamId ?? null,
    },
  });

  return { outcome, replayed: false, revision };
}
