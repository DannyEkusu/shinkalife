-- ShinkaLife 0006: assistant name + AI consent, reminder categories, user reminders, AI usage counter.
-- Backward compatible: only ADDS columns/tables; no existing data is changed. Requires 0001-0003.

-- 1. Per-user assistant preferences (existing `preferences` table, owner-only RLS already applies)
alter table public.preferences
  add column assistant_name text check (assistant_name is null or (
    char_length(assistant_name) between 1 and 30 and assistant_name = btrim(assistant_name) and assistant_name !~ '[[:cntrl:]<>&"`]')),
  add column ai_opt_in boolean not null default false;   -- privacy first: AI is OFF until the user turns it on

-- 2. Reminder categories the user switched off (existing `reminder_settings` table)
alter table public.reminder_settings
  add column muted_categories text[] not null default '{}'
    check (muted_categories <@ array['session','event','task','habit','custom']::text[]);

-- 3. User-created reminders
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 500),
  kind text not null default 'custom' check (kind in ('task','deadline','study','habit','activity','custom')),
  task_id uuid,
  remind_at timestamptz not null,                      -- first occurrence (an instant); recurrence keeps local wall-clock time in `tz`
  tz text not null default 'UTC' check (char_length(tz) between 1 and 64),
  rrule jsonb check (rrule is null or (jsonb_typeof(rrule) = 'object' and pg_column_size(rrule) < 1024)),
  status text not null default 'active' check (status in ('active','done','dismissed')),
  skip_until timestamptz,                              -- occurrences at or before this are dismissed/completed
  snoozed_until timestamptz,                           -- extra one-off alert after a snooze
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id)   -- can only link YOUR task
);
create index reminders_user_status on public.reminders (user_id, status, remind_at);
create trigger reminders_tz before insert or update of tz on public.reminders for each row execute function public.check_event_tz();
create trigger reminders_touch before update on public.reminders for each row execute function public.touch_updated_at();
alter table public.reminders enable row level security;
revoke all on public.reminders from anon;
create policy reminders_owner on public.reminders for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Daily AI usage counter. Clients have NO access; only the server-side Edge Function (service role) can touch it.
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
create function public.ai_consume(p_user uuid, p_limit integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'invalid limit'; end if;
  insert into public.ai_usage (user_id, day, calls) values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1 where public.ai_usage.calls < p_limit
  returning calls into n;
  return n is not null;                                -- false = daily limit reached (atomic, race-free)
end $$;
revoke execute on function public.ai_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_consume(uuid, integer) to service_role;
