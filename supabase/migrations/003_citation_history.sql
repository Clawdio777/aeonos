-- AEONOS — citation history: persist per-run citation snapshots + answer text for sentiment

alter table caller_memory
  add column if not exists citation_history jsonb default '[]';

comment on column caller_memory.citation_history is 'Array of citation check snapshots — powers delta comparison and future sentiment analysis. Each entry has: timestamp, domain, per-engine cited/total counts, per-query results, raw answer text.';
