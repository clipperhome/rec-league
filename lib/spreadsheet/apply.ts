import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import type { LeagueDocumentV1 } from "@/lib/portable";
import { applyPortableOperationInTransaction } from "@/lib/portable-server/apply-operation";
import { buildOrganizerLeagueDocument } from "@/lib/portable-server/document";
import type { PortableOperationActor } from "@/lib/portable-server/operations";
import { planServerPortableOperations } from "@/lib/portable-server/reconcile-plan";

export class SpreadsheetAtomicApplyError extends Error {
  constructor(message = "Every spreadsheet change must be ready before anything can be applied.") {
    super(message);
    this.name = "SpreadsheetAtomicApplyError";
  }
}

export async function applySpreadsheetOperationsAtomically(
  tx: Prisma.TransactionClient,
  leagueId: string,
  current: LeagueDocumentV1,
  incoming: LeagueDocumentV1,
  actor: Extract<PortableOperationActor, { role: "ORGANIZER" }>,
): Promise<{ appliedCount: number; document: LeagueDocumentV1 }> {
  const plan = await planServerPortableOperations(
    tx,
    leagueId,
    current,
    incoming,
    actor,
  );
  const operations = incoming.sync?.pendingOperations ?? [];
  if (
    operations.length === 0 ||
    plan.items.length !== operations.length ||
    plan.items.some((item) => item.status !== "ready")
  ) {
    throw new SpreadsheetAtomicApplyError();
  }

  for (const operation of operations) {
    await applyPortableOperationInTransaction(tx, leagueId, actor, operation);
  }
  return {
    appliedCount: operations.length,
    document: await buildOrganizerLeagueDocument(tx, leagueId),
  };
}
