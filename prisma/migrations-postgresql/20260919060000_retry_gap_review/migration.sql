ALTER TABLE "LearningReport" ADD COLUMN "retryReview" JSONB;

-- Old completed retries have no targeted review. Reopen their source gaps for
-- verification, without inferring mastery or interrupting an active retry.
UPDATE "LearningGap" AS gap
SET "status" = 'OPEN', "resolvedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE gap."status" = 'IN_PROGRESS'
  AND EXISTS (
    SELECT 1 FROM "LearningSession" AS retry
    JOIN "LearningReport" AS result ON result."sessionId" = retry.id
    JOIN "LearningReport" AS original ON original.id = gap."reportId"
    JOIN "LearningSession" AS parent ON parent.id = original."sessionId"
    WHERE retry."sourceGapId" = gap.id AND retry."phase" = 'COMPLETED'
      AND retry."parentSessionId" = parent.id AND retry."userId" = parent."userId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "LearningSession" AS active
    WHERE active."sourceGapId" = gap.id
      AND active."phase" NOT IN ('COMPLETED', 'ABANDONED')
  );
