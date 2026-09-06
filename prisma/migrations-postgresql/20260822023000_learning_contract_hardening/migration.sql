UPDATE "LearningSession"
SET
  "socraticTurns" = LEAST("socraticTurns", 5),
  "maxTurns" = LEAST(GREATEST("maxTurns", 3), 5);

ALTER TABLE "LearningSession"
  ALTER COLUMN "maxTurns" SET DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LearningSession_maxTurns_check'
  ) THEN
    ALTER TABLE "LearningSession"
      ADD CONSTRAINT "LearningSession_maxTurns_check"
      CHECK ("maxTurns" BETWEEN 3 AND 5);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "LearningSession_userId_clientRequestId_key"
  ON "LearningSession"("userId", "clientRequestId");
