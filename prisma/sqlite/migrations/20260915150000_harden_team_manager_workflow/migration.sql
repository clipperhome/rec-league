-- Explicit token intent keeps organizer verification, team invitations, and
-- ownership changes from sharing ambiguous behavior.
ALTER TABLE "MagicLinkToken" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'SIGN_IN';

-- Team-manager invitations remain visibly pending until their one-use link is
-- accepted.
ALTER TABLE "TeamManager" ADD COLUMN "acceptedAt" DATETIME;

-- Reports are reviewed against the game state the manager originally saw.
ALTER TABLE "Game" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GameReport" ADD COLUMN "decisionNote" TEXT;
ALTER TABLE "GameReport" ADD COLUMN "gameVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GameReport" ADD COLUMN "pendingKey" TEXT;

CREATE UNIQUE INDEX "GameReport_pendingKey_key" ON "GameReport"("pendingKey");
