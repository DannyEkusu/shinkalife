-- ShinkaLife 0002: categories, tasks, subtasks (owner-only RLS, server-stamped completion)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name), unique (id, user_id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'todo' check (status in ('todo','doing','done')),
  quest_type text not null default 'side' check (quest_type in ('main','side','habit')),
  priority smallint not null default 2 check (priority between 1 and 3),
  due_at timestamptz,
  est_minutes integer check (est_minutes is null or est_minutes between 5 and 1440),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);
create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index tasks_user_status_due on public.tasks (user_id, status, due_at);
create index subtasks_task on public.subtasks (task_id);

create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- completed_at is stamped by the database so clients cannot forge completion times (XP will rely on this).
create function public.task_completion_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now();
  elsif new.status = 'done' then new.completed_at := old.completed_at;
  else new.completed_at := null; end if;
  return new;
end $$;
create trigger tasks_completion before insert or update on public.tasks for each row execute function public.task_completion_stamp();

alter table public.categories enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
revoke all on public.categories, public.tasks, public.subtasks from anon;

create policy categories_owner on public.categories for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tasks_owner on public.tasks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy subtasks_owner on public.subtasks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
