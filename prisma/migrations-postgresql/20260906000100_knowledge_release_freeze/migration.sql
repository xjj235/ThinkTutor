ALTER TABLE "KnowledgeRelease" DROP CONSTRAINT "KnowledgeRelease_status_check";
ALTER TABLE "KnowledgeRelease" ADD CONSTRAINT "KnowledgeRelease_status_check"
  CHECK ("status" IN ('DRAFT', 'FROZEN', 'REVIEWED', 'PUBLISHED', 'ARCHIVED'));
