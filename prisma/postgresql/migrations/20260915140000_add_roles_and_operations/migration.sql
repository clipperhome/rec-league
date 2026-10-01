CREATE TYPE "GameReportType" AS ENUM ('SCORE', 'RAINOUT', 'RESCHEDULE');
CREATE TYPE "GameReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "League"
    ADD COLUMN "gameDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN "venueName" TEXT,
    ADD COLUMN "venueAddress" TEXT,
    ADD COLUMN "venueUrl" TEXT,
    ADD COLUMN "winPoints" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "tiePoints" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "lossPoints" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "showStandings" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "MagicLinkToken" ADD COLUMN "teamId" TEXT;

CREATE TABLE "TeamManager" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamManager_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameReport" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" "GameReportType" NOT NULL,
    "status" "GameReportStatus" NOT NULL DEFAULT 'PENDING',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "proposedScheduledAt" TIMESTAMP(3),
    "proposedFieldName" TEXT,
    "note" TEXT,
    "submittedByEmail" TEXT NOT NULL,
    "reviewedByEmail" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "gameId" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamManager_teamId_email_key" ON "TeamManager"("teamId", "email");
CREATE INDEX "TeamManager_email_leagueId_idx" ON "TeamManager"("email", "leagueId");
CREATE INDEX "TeamManager_leagueId_teamId_idx" ON "TeamManager"("leagueId", "teamId");
CREATE INDEX "GameReport_leagueId_status_createdAt_idx" ON "GameReport"("leagueId", "status", "createdAt");
CREATE INDEX "GameReport_teamId_status_createdAt_idx" ON "GameReport"("teamId", "status", "createdAt");
CREATE INDEX "GameReport_gameId_status_idx" ON "GameReport"("gameId", "status");
CREATE INDEX "ActivityEvent_leagueId_createdAt_idx" ON "ActivityEvent"("leagueId", "createdAt");

ALTER TABLE "TeamManager" ADD CONSTRAINT "TeamManager_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamManager" ADD CONSTRAINT "TeamManager_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameReport" ADD CONSTRAINT "GameReport_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameReport" ADD CONSTRAINT "GameReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameReport" ADD CONSTRAINT "GameReport_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
