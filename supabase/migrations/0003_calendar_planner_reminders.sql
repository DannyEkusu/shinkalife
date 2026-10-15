-- ShinkaLife 0003: availability, events (+exceptions), schedule blocks, planner drafts, reminders, reviews
create extension if not exists btree_gist;

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 1 and 1440),
  check (end_min > start_min), unique (user_id, weekday, start_min)
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  start_at timestamptz not null, end_at timestamptz not null,
  tz text not null default 'UTC' check (char_length(tz) between 1 and 64),
  rrule jsonb check (rrule is null or (jsonb_typeof(rrule) = 'object' and pg_column_size(rrule) < 1024)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_at > start_at and end_at - start_at <= interval '24 hours'), unique (id, user_id)
);
create table public.event_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id uuid not null, occurrence_date date not null,
  action text not null check (action in ('skip','move')), new_start timestamptz, new_end timestamptz,
  check ((action = 'skip' and new_start is null and new_end is null) or (action = 'move' and new_start is not null and new_end > new_start)),
  unique (event_id, occurrence_date),
  foreign key (event_id, user_id) references public.events (id, user_id) on delete cascade
);
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid, title text not null check (char_length(title) between 1 and 120),
  start_at timestamptz not null, end_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned','done','missed','skipped')),
  source text not null default 'manual' check (source in ('manual','rules','ai')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_at > start_at and end_at - start_at <= interval '12 hours'),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade,
  -- the database itself refuses overlapping planned work, whatever the client does
  exclude using gist (user_id with =, tstzrange(start_at, end_at) with &&) where (status = 'planned')
);
create table public.planner_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  input text not null check (char_length(input) <= 2000), source text not null check (source in ('rules','ai')),
  proposal jsonb not null check (pg_column_size(proposal) < 65536),
  status text not null default 'draft' check (status in ('draft','approved','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.reminder_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default true, lead_minutes smallint not null default 10 check (lead_minutes between 0 and 1440),
  quiet_start_min smallint not null default 1320 check (quiet_start_min between 0 and 1439),
  quiet_end_min smallint not null default 420 check (quiet_end_min between 0 and 1439),
  max_per_day smallint not null default 8 check (max_per_day between 1 and 50), paused_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) <= 256), auth text not null check (char_length(auth) <= 256),
  created_at timestamptz not null default now(), unique (user_id, endpoint)
);
create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null, notes text not null check (char_length(notes) <= 2000), unique (user_id, week_start)
);

create function public.check_event_tz() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then raise exception 'Invalid IANA timezone: %', new.tz; end if;
  return new;
end $$;
create trigger events_tz before insert or update of tz on public.events for each row execute function public.check_event_tz();
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();
create trigger blocks_touch before update on public.schedule_blocks for each row execute function public.touch_updated_at();
create trigger drafts_touch before update on public.planner_drafts for each row execute function public.touch_updated_at();
create trigger reminders_touch before update on public.reminder_settings for each row execute function public.touch_updated_at();
create index blocks_user_start on public.schedule_blocks (user_id, start_at);
create index events_user_start on public.events (user_id, start_at);

do $$ declare x text; begin
  foreach x in array array['availability','events','event_exceptions','schedule_blocks','planner_drafts','reminder_settings','push_subscriptions','weekly_reviews'] loop
    execute format('alter table public.%I enable row level security', x);
    execute format('revoke all on public.%I from anon', x);
    execute format('create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', x || '_owner', x);
  end loop; end $$;
