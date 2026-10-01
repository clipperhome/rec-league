CREATE TABLE "ImportPreview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "organizerEmail" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceJson" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportPreview_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ImportPreview_leagueId_organizerEmail_expiresAt_idx"
ON "ImportPreview"("leagueId", "organizerEmail", "expiresAt");

CREATE INDEX "ImportPreview_expiresAt_idx"
ON "ImportPreview"("expiresAt");
