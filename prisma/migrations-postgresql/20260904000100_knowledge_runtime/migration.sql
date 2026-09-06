ALTER TABLE "LearningSession" ADD COLUMN "knowledgeRuntime" JSONB;
ALTER TABLE "LearningReport" ADD COLUMN "sessionVersions" JSONB;
ALTER TABLE "LearningReport" ADD COLUMN "evidenceLinks" JSONB;
