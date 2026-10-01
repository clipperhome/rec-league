ALTER TABLE "League" ADD COLUMN "dataRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "League" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "League" ADD COLUMN "publicUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Team" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Result" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TeamManager" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GameReport" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ActivityEvent" ADD COLUMN "actorRole" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "ActivityEvent" ADD COLUMN "operationId" TEXT;
ALTER TABLE "ActivityEvent" ADD COLUMN "detailsJson" TEXT;

CREATE INDEX "ActivityEvent_leagueId_operationId_idx"
ON "ActivityEvent"("leagueId", "operationId");

CREATE TABLE "AppliedOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorEmail" TEXT,
    "teamId" TEXT,
    "appliedRevision" INTEGER NOT NULL,
    "outcomeJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppliedOperation_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AppliedOperation_leagueId_operationId_key"
ON "AppliedOperation"("leagueId", "operationId");

CREATE INDEX "AppliedOperation_leagueId_appliedRevision_idx"
ON "AppliedOperation"("leagueId", "appliedRevision");

INSERT INTO "ActivityEvent" (
    "id", "leagueId", "actorRole", "type", "summary", "createdAt"
)
SELECT
    'portability_' || "id",
    "id",
    'SYSTEM',
    'PORTABILITY_ENABLED',
    'Established portable data revision 1 for this league.',
    CURRENT_TIMESTAMP
FROM "League";
