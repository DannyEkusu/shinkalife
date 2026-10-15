-- ShinkaLife 0001: profiles + preferences with owner-only RLS
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme jsonb not null default '{}'::jsonb
    check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) < 2048),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create function public.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end if;
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger prefs_touch before update on public.preferences
  for each row execute function public.touch_updated_at();
create trigger profiles_tz before insert or update of timezone on public.profiles
  for each row execute function public.check_timezone();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, nullif(left(new.raw_user_meta_data->>'display_name', 60), ''));
  insert into public.preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
revoke all on public.profiles, public.preferences from anon;

create policy profiles_select on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy prefs_select on public.preferences for select to authenticated using (auth.uid() = user_id);
create policy prefs_insert on public.preferences for insert to authenticated with check (auth.uid() = user_id);
create policy prefs_update on public.preferences for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No client DELETE policies: account deletion will go through a server function (later phase).
