CREATE TYPE "MagicLinkPurpose" AS ENUM ('SIGN_IN', 'TEAM_MANAGER_INVITE', 'ORGANIZER_EMAIL_CHANGE');

ALTER TABLE "MagicLinkToken"
    ADD COLUMN "purpose" "MagicLinkPurpose" NOT NULL DEFAULT 'SIGN_IN';

ALTER TABLE "TeamManager" ADD COLUMN "acceptedAt" TIMESTAMP(3);

ALTER TABLE "Game" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "GameReport"
    ADD COLUMN "decisionNote" TEXT,
    ADD COLUMN "gameVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "pendingKey" TEXT;

CREATE UNIQUE INDEX "GameReport_pendingKey_key" ON "GameReport"("pendingKey");
