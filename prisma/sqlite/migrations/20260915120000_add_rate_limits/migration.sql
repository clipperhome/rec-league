CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "RateLimitEvent_action_keyHash_createdAt_idx"
ON "RateLimitEvent"("action", "keyHash", "createdAt");

CREATE INDEX "RateLimitEvent_createdAt_idx"
ON "RateLimitEvent"("createdAt");
