-- ShinkaLife 0004: authoritative XP. Clients can READ the ledger; only award_task_xp() can write it.
alter table public.tasks add column skill text check (skill is null or skill in ('scholar','builder','artist','musician','athlete','explorer'));

create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('task','achievement','manual')), source_id uuid not null,
  xp integer not null check (xp between 0 and 200), skill text, note text,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)              -- one reward per source, ever
);
create table public.achievements_unlocked (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key in ('first-quest','ten-quests','level-5')), unlocked_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.xp_ledger enable row level security; alter table public.achievements_unlocked enable row level security;
revoke all on public.xp_ledger, public.achievements_unlocked from anon, authenticated;
grant select on public.xp_ledger, public.achievements_unlocked to authenticated;
create policy xp_read on public.xp_ledger for select to authenticated using (auth.uid() = user_id);
create policy ach_read on public.achievements_unlocked for select to authenticated using (auth.uid() = user_id);

-- Mirrors js/xp-core.js: base 10/20/30 by priority, x2 for main quests, 300 XP/day cap from tasks (user's timezone). XP is never removed.
create function public.award_task_xp(p_task_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t record; tz text; base int; used int; amount int; n int; cnt int; tot int; lvl int := 1; need int := 100; left_xp int; day_start timestamptz;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select * into t from public.tasks where id = p_task_id and user_id = uid;
  if not found then raise exception 'task not found'; end if;
  if t.status <> 'done' or t.completed_at is null then raise exception 'task is not completed'; end if;
  select coalesce(p.timezone, 'UTC') into tz from public.profiles p where p.id = uid; tz := coalesce(tz, 'UTC');
  base := (case t.priority when 1 then 10 when 3 then 30 else 20 end) * (case when t.quest_type = 'main' then 2 else 1 end);
  day_start := date_trunc('day', now() at time zone tz) at time zone tz;
  select coalesce(sum(xp), 0) into used from public.xp_ledger where user_id = uid and source_type = 'task' and created_at >= day_start;
  amount := greatest(0, least(base, 300 - used));
  insert into public.xp_ledger (user_id, source_type, source_id, xp, skill, note) values (uid, 'task', p_task_id, amount, t.skill, left(t.title, 120)) on conflict do nothing;
  get diagnostics n = row_count;
  select count(*) into cnt from public.xp_ledger where user_id = uid and source_type = 'task';
  select coalesce(sum(xp), 0) into tot from public.xp_ledger where user_id = uid;
  if cnt >= 1 then insert into public.achievements_unlocked (user_id, key) values (uid, 'first-quest') on conflict do nothing; end if;
  if cnt >= 10 then insert into public.achievements_unlocked (user_id, key) values (uid, 'ten-quests') on conflict do nothing; end if;
  left_xp := tot; while left_xp >= need loop left_xp := left_xp - need; lvl := lvl + 1; need := 100 + 50 * (lvl - 1); end loop;
  if lvl >= 5 then insert into public.achievements_unlocked (user_id, key) values (uid, 'level-5') on conflict do nothing; end if;
  return jsonb_build_object('awarded', n = 1, 'xp', case when n = 1 then amount else 0 end, 'total_xp', tot, 'level', lvl);
end $$;
revoke execute on function public.award_task_xp(uuid) from public, anon;
grant execute on function public.award_task_xp(uuid) to authenticated;
