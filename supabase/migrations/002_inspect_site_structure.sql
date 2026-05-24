-- AEONOS — inspectSiteStructure: add audit history columns to caller_memory

alter table caller_memory
  add column if not exists audit_history       jsonb        default '[]',
  add column if not exists last_audit_timestamp timestamptz,
  add column if not exists schema_state        jsonb        default '{}',
  add column if not exists entity_score        integer,
  add column if not exists eat_score           integer,
  add column if not exists llms_txt_present    boolean;

comment on column caller_memory.audit_history is 'Array of past audit snapshots — powers delta comparison for returning callers';
comment on column caller_memory.last_audit_timestamp is 'When the last inspectSiteStructure audit ran';
comment on column caller_memory.schema_state is 'Latest schema types present + malformed count';
comment on column caller_memory.entity_score is 'Last entity disambiguation score (0-100)';
comment on column caller_memory.eat_score is 'Last E-E-A-T score (0-100)';
comment on column caller_memory.llms_txt_present is 'Whether llms.txt was found on last audit';
