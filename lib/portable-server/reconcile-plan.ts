import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  planPortableOperations,
  portableOperationTarget,
  type LeagueDocumentV1,
  type PortableOperation,
  type PortableSyncPreview,
  type PortableSyncPreviewItem,
} from "@/lib/portable";

import {
  hashPortableOperationPayload,
  type PortableOperationActor,
} from "./operations";

type ReceiptState = "conflict" | "replay";

/**
 * Adds persisted idempotency receipts to the pure optimistic plan. Exact
 * receipts are omitted while simulating because the current snapshot already
 * includes their effect; they are then reinserted as safe replay items.
 */
export async function planServerPortableOperations(
  tx: Prisma.TransactionClient,
  leagueId: string,
  current: LeagueDocumentV1,
  incoming: LeagueDocumentV1,
  actor: PortableOperationActor,
): Promise<PortableSyncPreview> {
  const operations = incoming.sync?.pendingOperations ?? [];
  const receiptStates = await loadReceiptStates(tx, leagueId, operations, actor);
  const withoutReplays: LeagueDocumentV1 = {
    ...incoming,
    sync: incoming.sync
      ? {
          ...incoming.sync,
          pendingOperations: operations.filter(
            (operation) => receiptStates.get(operation.operationId) !== "replay",
          ),
        }
      : undefined,
  };
  const purePlan = planPortableOperations(
    current,
    withoutReplays,
    actor.role === "ORGANIZER"
      ? { role: "ORGANIZER" }
      : { role: "MANAGER", teamId: actor.teamId },
  );
  const plannedById = new Map(
    purePlan.items.map((item) => [item.operationId, item]),
  );
  const failedTargets = new Set<string>();
  const items: PortableSyncPreviewItem[] = [];

  for (const operation of operations) {
    const target = portableOperationTarget(operation);
    const receipt = receiptStates.get(operation.operationId);
    let item: PortableSyncPreviewItem;
    if (receipt === "replay") {
      item = {
        kind: operation.kind,
        message: "Already applied online; ready to remove from this outbox.",
        operationId: operation.operationId,
        status: "ready",
      };
    } else if (target && failedTargets.has(target)) {
      item = {
        kind: operation.kind,
        message: "An earlier operation for this record needs attention first.",
        operationId: operation.operationId,
        status: "blocked-by-dependency",
      };
    } else if (receipt === "conflict") {
      item = {
        kind: operation.kind,
        message:
          "This operation ID was already used for different content or by a different actor.",
        operationId: operation.operationId,
        status: "conflict",
      };
    } else {
      item = plannedById.get(operation.operationId) ?? {
        kind: operation.kind,
        message: "The operation could not be planned.",
        operationId: operation.operationId,
        status: "rejected",
      };
    }

    if (item.status !== "ready" && target) failedTargets.add(target);
    items.push(item);
  }

  return summarize(items);
}

async function loadReceiptStates(
  tx: Prisma.TransactionClient,
  leagueId: string,
  operations: PortableOperation[],
  actor: PortableOperationActor,
): Promise<Map<string, ReceiptState>> {
  if (!operations.length) return new Map();
  const receipts = await tx.appliedOperation.findMany({
    where: {
      leagueId,
      operationId: { in: operations.map((operation) => operation.operationId) },
    },
    select: {
      actorEmail: true,
      actorRole: true,
      operationId: true,
      operationType: true,
      payloadHash: true,
      teamId: true,
    },
  });
  const byId = new Map(receipts.map((receipt) => [receipt.operationId, receipt]));
  const normalizedEmail = actor.email.trim().toLocaleLowerCase();
  return new Map(
    operations.flatMap((operation) => {
      const receipt = byId.get(operation.operationId);
      if (!receipt) return [];
      const sameActor =
        receipt.actorRole === actor.role &&
        receipt.actorEmail?.trim().toLocaleLowerCase() === normalizedEmail &&
        (receipt.teamId ?? null) === (actor.teamId ?? null);
      const sameOperation =
        receipt.operationType === operation.kind &&
        receipt.payloadHash ===
          hashPortableOperationPayload(operation.kind, operation.payload);
      return [
        [operation.operationId, sameActor && sameOperation ? "replay" : "conflict"],
      ];
    }),
  );
}

function summarize(items: PortableSyncPreviewItem[]): PortableSyncPreview {
  return {
    blockedCount: items.filter((item) => item.status === "blocked-by-dependency")
      .length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    items,
    readyCount: items.filter((item) => item.status === "ready").length,
    rejectedCount: items.filter((item) => item.status === "rejected").length,
  };
}
