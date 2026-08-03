-- CreateTable
CREATE TABLE "LearningSession" (
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
    CONSTRAINT "LearningSession_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "LearningSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "questionType" TEXT,
    "clientRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "conceptScore" INTEGER NOT NULL,
    "logicScore" INTEGER NOT NULL,
    "clarityScore" INTEGER NOT NULL,
    "exampleScore" INTEGER NOT NULL,
    "transferScore" INTEGER NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "dimensionsJson" TEXT NOT NULL,
    "masteredJson" TEXT NOT NULL,
    "gapsJson" TEXT NOT NULL,
    "nextStepsJson" TEXT NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LearningSession_parentSessionId_idx" ON "LearningSession"("parentSessionId");

-- CreateIndex
CREATE INDEX "LearningSession_phase_idx" ON "LearningSession"("phase");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_sessionId_clientRequestId_key" ON "Message"("sessionId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSession_parentSessionId_retryRequestId_key" ON "LearningSession"("parentSessionId", "retryRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningReport_sessionId_key" ON "LearningReport"("sessionId");
