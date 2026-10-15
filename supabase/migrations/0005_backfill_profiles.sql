-- ShinkaLife 0005: give EXISTING accounts their profile + preferences rows.
-- Why: the signup trigger (0001) only runs for users created AFTER it exists. Accounts made before 0001 was applied have no rows.
-- Safe: inserts only, never updates or deletes, and "on conflict do nothing" makes it harmless to run more than once.
insert into public.profiles (id, display_name)
select u.id, nullif(left(u.raw_user_meta_data->>'display_name', 60), '') from auth.users u
on conflict (id) do nothing;

insert into public.preferences (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;
