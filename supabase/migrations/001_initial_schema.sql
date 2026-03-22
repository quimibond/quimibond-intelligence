-- Quimibond Intelligence - Initial Schema
-- 18 tables, 6 RPC functions, RLS policies, vector index
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
  name          text,
  email         text unique,
  phone         text,
  company       text,
  city          text,
  country       text,
  odoo_partner_id integer unique,
  risk_level    text check (risk_level in ('low', 'medium', 'high')) default 'low',
  sentiment_score numeric(4,2),
  last_interaction timestamptz,
  total_emails  integer default 0,
  tags          text[] default '{}',
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
  contact_id          uuid not null references contacts(id) on delete cascade,
  personality_traits  text[] default '{}',
  communication_style text,
  interests           text[] default '{}',
  decision_factors    text[] default '{}',
  summary             text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (contact_id)
);

-- ============================================================
-- 3. email_threads
-- ============================================================
create table email_threads (
  id          uuid primary key default gen_random_uuid(),
  subject     text,
  contact_id  uuid references contacts(id) on delete set null,
  message_count integer default 0,
  last_message_at timestamptz,
  created_at  timestamptz default now()
);

create index idx_threads_contact on email_threads (contact_id);

-- ============================================================
-- 4. emails
-- ============================================================
create table emails (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid references email_threads(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,
  account_email text not null,
  from_address  text,
  to_addresses  text[] default '{}',
  cc_addresses  text[] default '{}',
  subject       text,
  body_text     text,
  body_html     text,
  direction     text check (direction in ('inbound', 'outbound')) not null,
  message_id    text unique,
  in_reply_to   text,
  received_at   timestamptz,
  processed     boolean default false,
  created_at    timestamptz default now()
);

create index idx_emails_contact on emails (contact_id);
create index idx_emails_thread on emails (thread_id);
create index idx_emails_received on emails (received_at desc);
create index idx_emails_processed on emails (processed) where not processed;

-- ============================================================
-- 5. email_attachments
-- ============================================================
create table email_attachments (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references emails(id) on delete cascade,
  filename    text not null,
  mime_type   text,
  size_bytes  integer,
  storage_path text,
  created_at  timestamptz default now()
);

-- ============================================================
-- 6. email_analyses
-- ============================================================
create table email_analyses (
  id            uuid primary key default gen_random_uuid(),
  email_id      uuid not null references emails(id) on delete cascade,
  sentiment     numeric(4,2),
  intent        text,
  summary       text,
  key_phrases   text[] default '{}',
  language      text default 'es',
  model_used    text,
  raw_response  jsonb,
  created_at    timestamptz default now(),
  unique (email_id)
);

-- ============================================================
-- 7. topics
-- ============================================================
create table topics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  category    text,
  created_at  timestamptz default now()
);

-- ============================================================
-- 8. email_topics (many-to-many)
-- ============================================================
create table email_topics (
  email_id  uuid not null references emails(id) on delete cascade,
  topic_id  uuid not null references topics(id) on delete cascade,
  relevance numeric(3,2) default 1.0,
  primary key (email_id, topic_id)
);

-- ============================================================
-- 9. facts
-- ============================================================
create table facts (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts(id) on delete set null,
  email_id      uuid references emails(id) on delete set null,
  fact_text     text not null,
  fact_type     text,
  confidence    numeric(3,2) default 1.0,
  source_type   text check (source_type in ('email', 'call', 'manual', 'system')) default 'email',
  valid_from    timestamptz default now(),
  valid_until   timestamptz,
  created_at    timestamptz default now()
);

create index idx_facts_contact on facts (contact_id);

-- ============================================================
-- 10. contact_interactions
-- ============================================================
create table contact_interactions (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  interaction_type text not null,
  channel         text,
  summary         text,
  sentiment       numeric(4,2),
  occurred_at     timestamptz not null,
  email_id        uuid references emails(id) on delete set null,
  created_at      timestamptz default now()
);

create index idx_interactions_contact on contact_interactions (contact_id, occurred_at desc);

-- ============================================================
-- 11. alerts
-- ============================================================
create table alerts (
  id            uuid primary key default gen_random_uuid(),
  alert_type    text not null,
  severity      text check (severity in ('low', 'medium', 'high', 'critical')) default 'medium',
  title         text not null,
  description   text,
  contact_id    uuid references contacts(id) on delete set null,
  contact_name  text,
  email_id      uuid references emails(id) on delete set null,
  state         text check (state in ('new', 'acknowledged', 'resolved')) default 'new',
  is_read       boolean default false,
  rule_id       uuid,
  created_at    timestamptz default now(),
  resolved_at   timestamptz
);

create index idx_alerts_state on alerts (state);
create index idx_alerts_contact on alerts (contact_id);
create index idx_alerts_created on alerts (created_at desc);

-- ============================================================
-- 12. alert_rules
-- ============================================================
create table alert_rules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  alert_type    text not null,
  severity      text default 'medium',
  conditions    jsonb not null default '{}',
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table alerts add constraint fk_alerts_rule foreign key (rule_id) references alert_rules(id) on delete set null;

-- ============================================================
-- 13. action_items
-- ============================================================
create table action_items (
  id            uuid primary key default gen_random_uuid(),
  action_type   text not null,
  description   text not null,
  contact_id    uuid references contacts(id) on delete set null,
  contact_name  text,
  email_id      uuid references emails(id) on delete set null,
  priority      text check (priority in ('low', 'medium', 'high')) default 'medium',
  due_date      date,
  state         text check (state in ('pending', 'completed', 'dismissed')) default 'pending',
  created_at    timestamptz default now(),
  completed_at  timestamptz
);

create index idx_actions_state on action_items (state);
create index idx_actions_contact on action_items (contact_id);
create index idx_actions_due on action_items (due_date) where state = 'pending';

-- ============================================================
-- 14. briefings
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
-- 15. briefing_sections
-- ============================================================
create table briefing_sections (
  id            uuid primary key default gen_random_uuid(),
  briefing_id   uuid not null references briefings(id) on delete cascade,
  section_type  text not null,
  title         text,
  content       text,
  sort_order    integer default 0,
  metadata      jsonb default '{}'
);

-- ============================================================
-- 16. embeddings
-- ============================================================
create table embeddings (
  id            uuid primary key default gen_random_uuid(),
  source_type   text not null,
  source_id     uuid not null,
  content_hash  text,
  embedding     vector(1536),
  model_used    text default 'text-embedding-3-small',
  created_at    timestamptz default now()
);

create index idx_embeddings_source on embeddings (source_type, source_id);
create index idx_embeddings_vector on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- 17. pipeline_runs
-- ============================================================
create table pipeline_runs (
  id            uuid primary key default gen_random_uuid(),
  pipeline_name text not null,
  status        text check (status in ('running', 'completed', 'failed')) default 'running',
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  emails_processed integer default 0,
  metadata      jsonb default '{}'
);

-- ============================================================
-- 18. pipeline_logs
-- ============================================================
create table pipeline_logs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references pipeline_runs(id) on delete cascade,
  level       text check (level in ('debug', 'info', 'warning', 'error')) default 'info',
  message     text not null,
  details     jsonb,
  created_at  timestamptz default now()
);

create index idx_plogs_run on pipeline_logs (run_id, created_at);

-- ============================================================
-- RLS Policies
-- ============================================================
-- Enable RLS on all tables (data is accessed via service key from
-- the Odoo pipeline and via anon key from the Next.js frontend).

alter table contacts            enable row level security;
alter table person_profiles     enable row level security;
alter table email_threads       enable row level security;
alter table emails              enable row level security;
alter table email_attachments   enable row level security;
alter table email_analyses      enable row level security;
alter table topics              enable row level security;
alter table email_topics        enable row level security;
alter table facts               enable row level security;
alter table contact_interactions enable row level security;
alter table alerts              enable row level security;
alter table alert_rules         enable row level security;
alter table action_items        enable row level security;
alter table briefings           enable row level security;
alter table briefing_sections   enable row level security;
alter table embeddings          enable row level security;
alter table pipeline_runs       enable row level security;
alter table pipeline_logs       enable row level security;

-- Anon users: read-only access to business tables
create policy "anon_read_contacts"       on contacts            for select to anon using (true);
create policy "anon_read_profiles"       on person_profiles     for select to anon using (true);
create policy "anon_read_threads"        on email_threads       for select to anon using (true);
create policy "anon_read_emails"         on emails              for select to anon using (true);
create policy "anon_read_attachments"    on email_attachments   for select to anon using (true);
create policy "anon_read_analyses"       on email_analyses      for select to anon using (true);
create policy "anon_read_topics"         on topics              for select to anon using (true);
create policy "anon_read_email_topics"   on email_topics        for select to anon using (true);
create policy "anon_read_facts"          on facts               for select to anon using (true);
create policy "anon_read_interactions"   on contact_interactions for select to anon using (true);
create policy "anon_read_alerts"         on alerts              for select to anon using (true);
create policy "anon_read_alert_rules"    on alert_rules         for select to anon using (true);
create policy "anon_read_actions"        on action_items        for select to anon using (true);
create policy "anon_read_briefings"      on briefings           for select to anon using (true);
create policy "anon_read_sections"       on briefing_sections   for select to anon using (true);
create policy "anon_read_embeddings"     on embeddings          for select to anon using (true);
create policy "anon_read_pipeline_runs"  on pipeline_runs       for select to anon using (true);
create policy "anon_read_pipeline_logs"  on pipeline_logs       for select to anon using (true);

-- Anon users: can update alert state and action_item state (for the frontend UI)
create policy "anon_update_alerts"  on alerts       for update to anon using (true) with check (true);
create policy "anon_update_actions" on action_items  for update to anon using (true) with check (true);

-- Service role has full access by default (bypasses RLS)

-- ============================================================
-- RPC Functions
-- ============================================================

-- 1. search_similar_emails: vector similarity search
create or replace function search_similar_emails(
  query_embedding vector(1536),
  match_count int default 10,
  similarity_threshold float default 0.7
)
returns table (
  source_id uuid,
  similarity float
)
language plpgsql
as $$
begin
  return query
    select e.source_id,
           1 - (e.embedding <=> query_embedding) as similarity
    from embeddings e
    where e.source_type = 'email'
      and 1 - (e.embedding <=> query_embedding) > similarity_threshold
    order by e.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- 2. get_contact_summary: aggregated contact info
create or replace function get_contact_summary(p_contact_id uuid)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'contact', row_to_json(c),
    'profile', (select row_to_json(pp) from person_profiles pp where pp.contact_id = c.id),
    'open_alerts', (select count(*) from alerts a where a.contact_id = c.id and a.state = 'new'),
    'pending_actions', (select count(*) from action_items ai where ai.contact_id = c.id and ai.state = 'pending'),
    'recent_facts', (
      select coalesce(json_agg(row_to_json(f)), '[]'::json)
      from (select * from facts where contact_id = c.id order by created_at desc limit 10) f
    ),
    'recent_interactions', (
      select coalesce(json_agg(row_to_json(ci)), '[]'::json)
      from (select * from contact_interactions where contact_id = c.id order by occurred_at desc limit 10) ci
    )
  ) into result
  from contacts c
  where c.id = p_contact_id;

  return result;
end;
$$;

-- 3. get_dashboard_stats: KPIs for the dashboard
create or replace function get_dashboard_stats()
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'total_emails', (select count(*) from emails),
    'open_alerts', (select count(*) from alerts where state = 'new'),
    'pending_actions', (select count(*) from action_items where state = 'pending'),
    'at_risk_contacts', (select count(*) from contacts where risk_level = 'high'),
    'emails_last_24h', (select count(*) from emails where received_at > now() - interval '24 hours'),
    'pipeline_last_run', (
      select json_build_object('status', status, 'started_at', started_at, 'emails_processed', emails_processed)
      from pipeline_runs order by started_at desc limit 1
    )
  ) into result;

  return result;
end;
$$;

-- 4. get_email_thread_context: full thread with analyses
create or replace function get_email_thread_context(p_thread_id uuid)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'thread', row_to_json(et),
    'messages', (
      select coalesce(json_agg(
        json_build_object(
          'email', row_to_json(e),
          'analysis', (select row_to_json(ea) from email_analyses ea where ea.email_id = e.id)
        ) order by e.received_at
      ), '[]'::json)
      from emails e where e.thread_id = et.id
    )
  ) into result
  from email_threads et
  where et.id = p_thread_id;

  return result;
end;
$$;

-- 5. refresh_contact_scores: recalculate risk and sentiment
create or replace function refresh_contact_scores()
returns integer
language plpgsql
as $$
declare
  updated_count integer;
begin
  with scores as (
    select
      c.id,
      coalesce(avg(ea.sentiment), 0) as avg_sentiment,
      count(distinct e.id) as email_count,
      max(e.received_at) as last_email,
      case
        when coalesce(avg(ea.sentiment), 0) < -0.3 then 'high'
        when coalesce(avg(ea.sentiment), 0) < 0.1 then 'medium'
        else 'low'
      end as computed_risk
    from contacts c
    left join emails e on e.contact_id = c.id
    left join email_analyses ea on ea.email_id = e.id
    group by c.id
  )
  update contacts c
  set
    sentiment_score = s.avg_sentiment,
    total_emails = s.email_count,
    last_interaction = s.last_email,
    risk_level = s.computed_risk,
    updated_at = now()
  from scores s
  where c.id = s.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- 6. get_briefing_data: gather data for briefing generation
create or replace function get_briefing_data(
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'period', json_build_object('start', p_period_start, 'end', p_period_end),
    'email_count', (
      select count(*) from emails where received_at between p_period_start and p_period_end
    ),
    'new_alerts', (
      select coalesce(json_agg(row_to_json(a)), '[]'::json)
      from alerts a where a.created_at between p_period_start and p_period_end
    ),
    'completed_actions', (
      select count(*) from action_items
      where completed_at between p_period_start and p_period_end
    ),
    'top_contacts', (
      select coalesce(json_agg(row_to_json(tc)), '[]'::json)
      from (
        select c.name, c.company, c.risk_level, c.sentiment_score, count(e.id) as period_emails
        from contacts c
        join emails e on e.contact_id = c.id
        where e.received_at between p_period_start and p_period_end
        group by c.id
        order by count(e.id) desc
        limit 10
      ) tc
    ),
    'key_facts', (
      select coalesce(json_agg(row_to_json(f)), '[]'::json)
      from (
        select * from facts
        where created_at between p_period_start and p_period_end
        order by confidence desc
        limit 20
      ) f
    )
  ) into result;

  return result;
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

create trigger trg_alert_rules_updated before update on alert_rules
  for each row execute function set_updated_at();
