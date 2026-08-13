-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LearningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "course" TEXT,
    "chapter" TEXT,
    "topic" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "learnerLevel" TEXT NOT NULL,
    "referenceText" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'DIAGNOSIS',
    "socraticRound" INTEGER NOT NULL DEFAULT 0,
    "unknownStreak" INTEGER NOT NULL DEFAULT 0,
    "feynmanExplanation" TEXT,
    "parentSessionId" TEXT,
    "retryRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningSession_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LearningSession" ("chapter", "course", "createdAt", "feynmanExplanation", "goal", "id", "learnerLevel", "parentSessionId", "phase", "referenceText", "retryRequestId", "socraticRound", "unknownStreak", "updatedAt") SELECT "chapter", "course", "createdAt", "feynmanExplanation", "goal", "id", "learnerLevel", "parentSessionId", "phase", "referenceText", "retryRequestId", "socraticRound", "unknownStreak", "updatedAt" FROM "LearningSession";
DROP TABLE "LearningSession";
ALTER TABLE "new_LearningSession" RENAME TO "LearningSession";
CREATE INDEX "LearningSession_parentSessionId_idx" ON "LearningSession"("parentSessionId");
CREATE INDEX "LearningSession_phase_idx" ON "LearningSession"("phase");
CREATE UNIQUE INDEX "LearningSession_parentSessionId_retryRequestId_key" ON "LearningSession"("parentSessionId", "retryRequestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
