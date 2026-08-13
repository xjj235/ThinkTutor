-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LearningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "course" TEXT,
    "chapter" TEXT,
    "topic" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "learnerLevel" TEXT NOT NULL,
    "referenceText" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'DIAGNOSIS',
    "socraticTurns" INTEGER NOT NULL DEFAULT 0,
    "maxTurns" INTEGER NOT NULL DEFAULT 5,
    "learnerState" JSONB,
    "parentSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningSession_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_LearningSession" (
    "id", "course", "chapter", "topic", "objective", "learnerLevel",
    "referenceText", "phase", "socraticTurns", "maxTurns", "learnerState",
    "parentSessionId", "createdAt", "updatedAt"
)
SELECT
    "id", "course", "chapter", "topic", "goal", "learnerLevel",
    "referenceText", "phase", "socraticRound", 5, NULL,
    "parentSessionId", "createdAt", "updatedAt"
FROM "LearningSession";

CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "questionType" TEXT,
    "clientRequestId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "new_LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Message" (
    "id", "sessionId", "role", "phase", "content", "questionType",
    "clientRequestId", "metadata", "createdAt"
)
SELECT
    "id", "sessionId",
    CASE WHEN "role" = 'SYSTEM_EVENT' THEN 'SYSTEM' ELSE "role" END,
    "phase", "content", "questionType",
    CASE
      WHEN "clientRequestId" IS NULL THEN NULL
      ELSE "sessionId" || ':' || "clientRequestId"
    END,
    NULL,
    "createdAt"
FROM "Message";

CREATE TABLE "new_LearningReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "overallLevel" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "nextSteps" JSONB NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "new_LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_LearningReport" (
    "id", "sessionId", "summary", "overallScore", "overallLevel",
    "dimensions", "strengths", "gaps", "nextSteps", "disclaimer", "createdAt"
)
SELECT
    "id", "sessionId", "summary", "overallScore",
    CASE
      WHEN "overallScore" >= 85 THEN '掌握良好'
      WHEN "overallScore" >= 70 THEN '发展中'
      ELSE '需要巩固'
    END,
    json("dimensionsJson"), json("masteredJson"), json("gapsJson"),
    json("nextStepsJson"), "disclaimer", "createdAt"
FROM "LearningReport";

DROP TABLE "LearningReport";
DROP TABLE "Message";
DROP TABLE "LearningSession";

ALTER TABLE "new_LearningSession" RENAME TO "LearningSession";
ALTER TABLE "new_Message" RENAME TO "Message";
ALTER TABLE "new_LearningReport" RENAME TO "LearningReport";

CREATE INDEX "LearningSession_parentSessionId_idx" ON "LearningSession"("parentSessionId");
CREATE INDEX "LearningSession_phase_idx" ON "LearningSession"("phase");
CREATE UNIQUE INDEX "Message_clientRequestId_key" ON "Message"("clientRequestId");
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
CREATE UNIQUE INDEX "LearningReport_sessionId_key" ON "LearningReport"("sessionId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
