-- Repoint stored Supabase Storage URLs from the old host to voltflow.life.
--
-- Some content rows hold ABSOLUTE Storage URLs (not storage paths), so they keep
-- pointing at supabase.mykid.life until rewritten. Both hosts serve the same
-- Supabase instance (nginx dual-serves them), so this is safe to run at any time
-- and nothing 404s during the transition.
--
-- knowledge_articles has a BEFORE UPDATE trigger (set_knowledge_articles_updated_at)
-- that stamps updated_at = now(). A plain UPDATE here would therefore mark five
-- articles as "recently updated" purely because of a hostname rewrite. The trigger
-- is disabled for the duration so updated_at keeps its real meaning — content edits.
-- Run in ONE transaction (psql -1) so the trigger can never be left disabled.
--
-- Idempotent by construction: replace() is a no-op once no old URLs remain, so
-- re-running changes nothing. Self-hosted has no schema_migrations table — this
-- file is the only record. Apply with psql (the CLI cannot reach the pooler).

update accessories
set image_url = replace(image_url, 'supabase.mykid.life', 'supabase.voltflow.life')
where image_url like '%supabase.mykid.life%';

update spare_parts
set images = replace(images::text, 'supabase.mykid.life', 'supabase.voltflow.life')::jsonb
where images::text like '%supabase.mykid.life%';

alter table knowledge_articles disable trigger set_knowledge_articles_updated_at;

update knowledge_articles
set images = replace(images::text, 'supabase.mykid.life', 'supabase.voltflow.life')::jsonb
where images::text like '%supabase.mykid.life%';

update knowledge_articles
set content = replace(content::text, 'supabase.mykid.life', 'supabase.voltflow.life')::jsonb
where content::text like '%supabase.mykid.life%';

alter table knowledge_articles enable trigger set_knowledge_articles_updated_at;
