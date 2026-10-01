-- Sessions created during league setup are scoped to that new league until
-- the commissioner proves email ownership through a magic link. Existing
-- sessions predate that distinction, so expire them once during migration.
ALTER TABLE "CommissionerSession" ADD COLUMN "scopeLeagueId" TEXT;
DELETE FROM "CommissionerSession";
