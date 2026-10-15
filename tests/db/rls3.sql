-- Migration 0005: backfill for users who signed up before the trigger existed
insert into auth.users (id, raw_user_meta_data) values ('eeeeeeee-0000-0000-0000-000000000005', '{"display_name":"Eve"}'), ('ffffffff-0000-0000-0000-000000000006', '{}');
select t.su();
delete from public.profiles where id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006');
delete from public.preferences where user_id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006');
select t.ok('precondition: pre-existing users have no profile rows', (select count(*) from public.profiles where id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006')) = 0);
\i :root/supabase/migrations/0005_backfill_profiles.sql
select t.ok('backfill creates profile and preferences for existing users', (select count(*) from public.profiles where id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006')) = 2 and (select count(*) from public.preferences where user_id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006')) = 2);
select t.ok('display name is carried over; a missing name stays empty', (select display_name from public.profiles where id = 'eeeeeeee-0000-0000-0000-000000000005') = 'Eve' and (select display_name from public.profiles where id = 'ffffffff-0000-0000-0000-000000000006') is null);
update public.profiles set display_name = 'Changed', timezone = 'Europe/London' where id = 'eeeeeeee-0000-0000-0000-000000000005';
\i :root/supabase/migrations/0005_backfill_profiles.sql
select t.ok('re-running is harmless and never overwrites later edits', (select display_name || timezone from public.profiles where id = 'eeeeeeee-0000-0000-0000-000000000005') = 'ChangedEurope/London' and (select count(*) from public.profiles where id in ('eeeeeeee-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000006')) = 2);
select t.as_user('eeeeeeee-0000-0000-0000-000000000005');
select t.ok('backfilled user can update their own profile (RLS still applies)', t.affected($$update public.profiles set display_name = 'Eve2'$$) = 1);
select t.ok('backfilled user cannot read or touch another profile', t.cnt('select 1 from public.profiles') = 1 and t.affected($$update public.profiles set display_name = 'x' where id = 'ffffffff-0000-0000-0000-000000000006'$$) = 0);
select t.su();
