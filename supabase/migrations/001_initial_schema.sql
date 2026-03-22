-- Quimibond Intelligence - Database Schema
-- 18 tables, 6 RPC functions, RLS policies
-- This schema supports the commercial intelligence pipeline
-- populated by the qb19 Odoo addon and consumed by the Next.js frontend.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- 1. contacts
-- ============================================================
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  name          text,
  company       text,
  contact_type  text,
  risk_level    text check (risk_level in ('low', 'medium', 'high')) default 'low',
  sentiment_score numeric(4,2),
  relationship_score numeric(4,2),
  last_interaction timestamptz,
  total_emails  integer default 0,
  tags          text[] default '{}',
  phone         text,
  city          text,
  country       text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_contacts_risk on contacts (risk_level);
create index idx_contacts_email on contacts (email);

-- ============================================================
-- 2. person_profiles
-- ============================================================
create table person_profiles (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid references contacts(id) on delete cascade,
  canonical_key       text,
  name                text,
  email               text,
  company             text,
  role                text,
  department          text,
  decision_power      text,
  communication_style text,
  personality_traits  text[] default '{}',
  interests           text[] default '{}',
  decision_factors    text[] default '{}',
  summary             text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ============================================================
-- 3. threads
-- ============================================================
create table threads (
  id                      uuid primary key default gen_random_uuid(),
  gmail_thread_id         text unique,
  subject                 text,
  status                  text,
  message_count           integer default 0,
  participant_emails      text[] default '{}',
  hours_without_response  numeric,
  last_sender             text,
  last_sender_type        text,
  account                 text,
  created_at              timestamptz default now()
);

-- ============================================================
-- 4. emails
-- ============================================================
create table emails (
  id                bigserial primary key,
  account           text,
  sender            text,
  recipient         text,
  subject           text,
  body              text,
  snippet           text,
  email_date        timestamptz,
  gmail_message_id  text unique,
  gmail_thread_id   text,
  sender_type       text,
  has_attachments   boolean default false,
  kg_processed      boolean default false,
  embedding         vector(1024),
  created_at        timestamptz default now()
);

create index idx_emails_date on emails (email_date desc);
create index idx_emails_sender on emails (sender);
create index idx_emails_thread on emails (gmail_thread_id);

-- ============================================================
-- 5. alerts
-- ============================================================
create table alerts (
  id            uuid primary key default gen_random_uuid(),
  alert_type    text not null,
  severity      text check (severity in ('low', 'medium', 'high', 'critical')) default 'medium',
  title         text not null,
  description   text,
  contact_name  text,
  contact_id    uuid references contacts(id) on delete set null,
  account       text,
  state         text check (state in ('new', 'acknowledged', 'resolved')) default 'new',
  is_read       boolean default false,
  created_at    timestamptz default now(),
  resolved_at   timestamptz
);

create index idx_alerts_state on alerts (state);
create index idx_alerts_contact on alerts (contact_id);
create index idx_alerts_created on alerts (created_at desc);

-- ============================================================
-- 6. action_items
-- ============================================================
create table action_items (
  id              uuid primary key default gen_random_uuid(),
  action_type     text not null,
  description     text not null,
  contact_name    text,
  contact_id      uuid references contacts(id) on delete set null,
  priority        text check (priority in ('low', 'medium', 'high')) default 'medium',
  due_date        date,
  state           text check (state in ('pending', 'completed', 'dismissed')) default 'pending',
  status          text,
  assignee_email  text,
  completed_date  timestamptz,
  created_at      timestamptz default now()
);

create index idx_actions_state on action_items (state);
create index idx_actions_due on action_items (due_date) where state = 'pending';

-- ============================================================
-- 7. briefings
-- ============================================================
create table briefings (
  id              uuid primary key default gen_random_uuid(),
  briefing_type   text not null,
  period_start    timestamptz,
  period_end      timestamptz,
  summary         text,
  html_content    text,
  account_email   text,
  model_used      text,
  created_at      timestamptz default now()
);

create index idx_briefings_created on briefings (created_at desc);

-- ============================================================
-- 8. response_metrics
-- ============================================================
create table response_metrics (
  id                uuid primary key default gen_random_uuid(),
  account           text,
  contact_id        uuid references contacts(id) on delete set null,
  avg_response_time numeric,
  total_sent        integer default 0,
  total_received    integer default 0,
  period_start      timestamptz,
  period_end        timestamptz,
  created_at        timestamptz default now()
);

-- ============================================================
-- 9. account_summaries
-- ============================================================
create table account_summaries (
  id              uuid primary key default gen_random_uuid(),
  account         text,
  period          text,
  total_emails    integer default 0,
  total_contacts  integer default 0,
  summary         text,
  created_at      timestamptz default now()
);

-- ============================================================
-- 10. daily_summaries
-- ============================================================
create table daily_summaries (
  id              uuid primary key default gen_random_uuid(),
  account         text,
  summary_date    date,
  email_count     integer default 0,
  summary         text,
  key_events      jsonb default '[]',
  created_at      timestamptz default now()
);

-- ============================================================
-- 11. entities
-- ============================================================
create table entities (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null,
  name            text not null,
  canonical_name  text,
  email           text,
  attributes      jsonb default '{}',
  last_seen       timestamptz,
  created_at      timestamptz default now()
);

create index idx_entities_type on entities (entity_type);
create index idx_entities_name on entities (canonical_name);

-- ============================================================
-- 12. entity_mentions
-- ============================================================
create table entity_mentions (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references entities(id) on delete cascade,
  email_id    bigint,
  context     text,
  created_at  timestamptz default now()
);

-- ============================================================
-- 13. entity_relationships
-- ============================================================
create table entity_relationships (
  id                uuid primary key default gen_random_uuid(),
  entity_a_id       uuid not null references entities(id) on delete cascade,
  entity_b_id       uuid not null references entities(id) on delete cascade,
  relationship_type text not null,
  confidence        numeric(3,2) default 1.0,
  created_at        timestamptz default now()
);

-- ============================================================
-- 14. facts
-- ============================================================
create table facts (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts(id) on delete set null,
  email_id      bigint,
  fact_text     text not null,
  fact_type     text,
  source_type   text default 'email',
  confidence    numeric(3,2) default 1.0,
  created_at    timestamptz default now()
);

create index idx_facts_contact on facts (contact_id);

-- ============================================================
-- 15. topics
-- ============================================================
create table topics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  category    text,
  created_at  timestamptz default now()
);

-- ============================================================
-- 16. sync_state
-- ============================================================
create table sync_state (
  id              uuid primary key default gen_random_uuid(),
  account         text unique not null,
  last_history_id text,
  emails_synced   integer default 0,
  updated_at      timestamptz default now()
);

-- ============================================================
-- 17. communication_patterns
-- ============================================================
create table communication_patterns (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete cascade,
  pattern_type    text,
  description     text,
  frequency       text,
  confidence      numeric(3,2) default 1.0,
  created_at      timestamptz default now()
);

-- ============================================================
-- 18. system_learning
-- ============================================================
create table system_learning (
  id              uuid primary key default gen_random_uuid(),
  learning_type   text not null,
  key             text,
  value           jsonb default '{}',
  source          text,
  created_at      timestamptz default now()
);

-- ============================================================
-- RLS - Enable on all tables
-- ============================================================
alter table contacts              enable row level security;
alter table person_profiles       enable row level security;
alter table threads               enable row level security;
alter table emails                enable row level security;
alter table alerts                enable row level security;
alter table action_items          enable row level security;
alter table briefings             enable row level security;
alter table response_metrics      enable row level security;
alter table account_summaries     enable row level security;
alter table daily_summaries       enable row level security;
alter table entities              enable row level security;
alter table entity_mentions       enable row level security;
alter table entity_relationships  enable row level security;
alter table facts                 enable row level security;
alter table topics                enable row level security;
alter table sync_state            enable row level security;
alter table communication_patterns enable row level security;
alter table system_learning       enable row level security;

-- Anon: read-only on all tables
create policy "anon_read_contacts"        on contacts              for select to anon using (true);
create policy "anon_read_profiles"        on person_profiles       for select to anon using (true);
create policy "anon_read_threads"         on threads               for select to anon using (true);
create policy "anon_read_emails"          on emails                for select to anon using (true);
create policy "anon_read_alerts"          on alerts                for select to anon using (true);
create policy "anon_read_actions"         on action_items          for select to anon using (true);
create policy "anon_read_briefings"       on briefings             for select to anon using (true);
create policy "anon_read_response_metrics" on response_metrics     for select to anon using (true);
create policy "anon_read_account_summaries" on account_summaries   for select to anon using (true);
create policy "anon_read_daily_summaries" on daily_summaries       for select to anon using (true);
create policy "anon_read_entities"        on entities              for select to anon using (true);
create policy "anon_read_entity_mentions" on entity_mentions       for select to anon using (true);
create policy "anon_read_entity_rels"     on entity_relationships  for select to anon using (true);
create policy "anon_read_facts"           on facts                 for select to anon using (true);
create policy "anon_read_topics"          on topics                for select to anon using (true);
create policy "anon_read_sync_state"      on sync_state            for select to anon using (true);
create policy "anon_read_comm_patterns"   on communication_patterns for select to anon using (true);
create policy "anon_read_sys_learning"    on system_learning       for select to anon using (true);

-- Anon: can update alert state and action_item state (frontend UI)
create policy "anon_update_alerts"  on alerts       for update to anon using (true) with check (true);
create policy "anon_update_actions" on action_items  for update to anon using (true) with check (true);

-- Service role has full access by default (bypasses RLS)

-- ============================================================
-- RPC Functions
-- ============================================================

-- 1. upsert_contact
create or replace function upsert_contact(
  p_email text,
  p_name text default null,
  p_company text default null,
  p_contact_type text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into contacts (email, name, company, contact_type)
  values (p_email, p_name, p_company, p_contact_type)
  on conflict (email) do update set
    name = coalesce(excluded.name, contacts.name),
    company = coalesce(excluded.company, contacts.company),
    contact_type = coalesce(excluded.contact_type, contacts.contact_type),
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- 2. get_account_scorecard
create or replace function get_account_scorecard(p_account text)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'total_emails', (select count(*) from emails where account = p_account),
    'open_alerts', (select count(*) from alerts where account = p_account and state = 'new'),
    'pending_actions', (select count(*) from action_items where state = 'pending'),
    'at_risk_contacts', (select count(*) from contacts where risk_level = 'high'),
    'sync', (select row_to_json(s) from sync_state s where s.account = p_account)
  ) into result;
  return result;
end;
$$;

-- 3. search_similar_emails
create or replace function search_similar_emails(
  query_embedding vector(1024),
  match_count int default 10,
  similarity_threshold float default 0.7
)
returns table (
  id bigint,
  subject text,
  snippet text,
  sender text,
  email_date timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
    select e.id, e.subject, e.snippet, e.sender, e.email_date,
           1 - (e.embedding <=> query_embedding) as similarity
    from emails e
    where e.embedding is not null
      and 1 - (e.embedding <=> query_embedding) > similarity_threshold
    order by e.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- 4. get_entity_intelligence
create or replace function get_entity_intelligence(p_entity_id uuid)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'entity', row_to_json(ent),
    'mentions', (
      select coalesce(json_agg(row_to_json(m)), '[]'::json)
      from (select * from entity_mentions where entity_id = ent.id order by created_at desc limit 20) m
    ),
    'relationships', (
      select coalesce(json_agg(json_build_object(
        'type', er.relationship_type,
        'confidence', er.confidence,
        'other', (select row_to_json(e2) from entities e2 where e2.id = case when er.entity_a_id = ent.id then er.entity_b_id else er.entity_a_id end)
      )), '[]'::json)
      from entity_relationships er
      where er.entity_a_id = ent.id or er.entity_b_id = ent.id
    )
  ) into result
  from entities ent
  where ent.id = p_entity_id;
  return result;
end;
$$;

-- 5. get_my_pending_actions
create or replace function get_my_pending_actions(p_email text default null)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select coalesce(json_agg(row_to_json(a)), '[]'::json) into result
  from (
    select * from action_items
    where state = 'pending'
      and (p_email is null or assignee_email = p_email)
    order by due_date asc nulls last
    limit 50
  ) a;
  return result;
end;
$$;

-- 6. upsert_topic
create or replace function upsert_topic(
  p_name text,
  p_category text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into topics (name, category)
  values (p_name, p_category)
  on conflict (name) do update set
    category = coalesce(excluded.category, topics.category)
  returning id into v_id;
  return v_id;
end;
$$;

-- ============================================================
-- Updated-at triggers
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

create trigger trg_profiles_updated before update on person_profiles
  for each row execute function set_updated_at();
