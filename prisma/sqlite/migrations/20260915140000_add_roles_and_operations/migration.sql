-- League operations and public logistics
ALTER TABLE "League" ADD COLUMN "gameDurationMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "League" ADD COLUMN "venueName" TEXT;
ALTER TABLE "League" ADD COLUMN "venueAddress" TEXT;
ALTER TABLE "League" ADD COLUMN "venueUrl" TEXT;
ALTER TABLE "League" ADD COLUMN "winPoints" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "League" ADD COLUMN "tiePoints" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "League" ADD COLUMN "lossPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "League" ADD COLUMN "showStandings" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "League" ADD COLUMN "archivedAt" DATETIME;

-- A magic link can optionally return a verified team manager to their team desk.
ALTER TABLE "MagicLinkToken" ADD COLUMN "teamId" TEXT;

CREATE TABLE "TeamManager" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamManager_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamManager_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TeamManager_teamId_email_key" ON "TeamManager"("teamId", "email");
CREATE INDEX "TeamManager_email_leagueId_idx" ON "TeamManager"("email", "leagueId");
CREATE INDEX "TeamManager_leagueId_teamId_idx" ON "TeamManager"("leagueId", "teamId");

CREATE TABLE "GameReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "proposedScheduledAt" DATETIME,
    "proposedFieldName" TEXT,
    "note" TEXT,
    "submittedByEmail" TEXT NOT NULL,
    "reviewedByEmail" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameReport_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameReport_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GameReport_leagueId_status_createdAt_idx" ON "GameReport"("leagueId", "status", "createdAt");
CREATE INDEX "GameReport_teamId_status_createdAt_idx" ON "GameReport"("teamId", "status", "createdAt");
CREATE INDEX "GameReport_gameId_status_idx" ON "GameReport"("gameId", "status");

CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "gameId" TEXT,
    "teamId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ActivityEvent_leagueId_createdAt_idx" ON "ActivityEvent"("leagueId", "createdAt");
