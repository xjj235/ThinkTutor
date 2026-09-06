ALTER TYPE "AuditAction" ADD VALUE 'KNOWLEDGE_REVIEWED';
ALTER TABLE "LearningReport" ADD COLUMN "evidenceAudit" JSONB;
CREATE TABLE "KnowledgeRelease" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "contentHash" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "sourceReviews" JSONB NOT NULL,
  "goldenSet" JSONB NOT NULL,
  "modelValidation" JSONB,
  "verifiedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeRelease_status_check" CHECK ("status" IN ('DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED'))
);
