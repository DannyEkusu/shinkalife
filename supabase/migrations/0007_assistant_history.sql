-- ShinkaLife 0007: assistant conversation history + per-user consent flags. Additive only; safe to run once after 0006.
alter table public.preferences
  add column ai_share_data boolean not null default false,   -- may the AI see a SMALL summary of my deadlines/schedule? (off by default)
  add column chat_history boolean not null default true;     -- save my assistant conversation in my account

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  source text not null check (source in ('user', 'ai', 'rules')),   -- who produced it: you, a real AI model, or the built-in rule-based assistant
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index assistant_messages_user_time on public.assistant_messages (user_id, created_at desc);
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_messages from anon;
create policy assistant_messages_owner on public.assistant_messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep only the newest 200 messages per user
create function public.trim_assistant_messages() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.assistant_messages where user_id = new.user_id and id in (
    select id from public.assistant_messages where user_id = new.user_id order by created_at desc, id desc offset 200);
  return null;
end $$;
create trigger assistant_messages_trim after insert on public.assistant_messages for each row execute function public.trim_assistant_messages();
