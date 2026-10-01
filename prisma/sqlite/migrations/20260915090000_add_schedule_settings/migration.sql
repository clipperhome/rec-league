-- Preserve the legacy value while adopting the schedule generator's field name.
ALTER TABLE "League" RENAME COLUMN "gameNights" TO "gameDays";

-- AddColumn
ALTER TABLE "League" ADD COLUMN "scheduleStartDate" TEXT;

-- AddColumn
ALTER TABLE "League" ADD COLUMN "gameTimes" TEXT;

-- AddColumn
ALTER TABLE "League" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles';
