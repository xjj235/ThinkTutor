-- Optional retrieval acceleration. Run only after confirming the RDS account may create extensions.
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'pg_trgm';

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MaterialChunk_searchText_trgm_idx"
ON "MaterialChunk" USING GIN ("searchText" gin_trgm_ops);
