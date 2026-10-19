\set ON_ERROR_STOP on
\set QUIET on
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated; grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;  -- mimics Supabase defaults, so our explicit REVOKEs are really tested
\i :root/supabase/migrations/0001_profiles_preferences.sql
\i :root/supabase/migrations/0002_categories_tasks_subtasks.sql
\i :root/supabase/migrations/0003_calendar_planner_reminders.sql
\i :root/supabase/migrations/0004_xp_ledger.sql
\i :root/supabase/migrations/0006_assistant_reminders_ai_usage.sql
\i :root/supabase/migrations/0007_assistant_history.sql
create schema t; grant usage on schema t to public;
create table t.ids (k text, v uuid); grant all on t.ids to public;
create function t.ok(n text, c boolean) returns void language plpgsql as $$ begin if c then raise notice 'PASS  %', n; else raise exception 'FAIL  %', n; end if; end $$;
create function t.fails(n text, q text) returns void language plpgsql as $$ begin
  begin execute q; exception when others then raise notice 'PASS  % (%)', n, left(sqlerrm, 60); return; end;
  raise exception 'FAIL  % (statement succeeded)', n; end $$;
create function t.affected(q text) returns int language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function t.cnt(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || q || ') x' into n; return n; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, false); set role authenticated; end $$;
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', false); set role anon; end $$;
create function t.su() returns void language plpgsql as $$ begin reset role; end $$;

insert into auth.users (id, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', '{"display_name":"Alice"}'), ('bbbbbbbb-0000-0000-0000-000000000002', '{"display_name":"Bob"}');
select t.ok('signup trigger creates profile + preferences for each user', (select count(*) from public.profiles) = 2 and (select count(*) from public.preferences) = 2);

select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.categories (name) values ('Study');
insert into public.tasks (title, category_id, quest_type) select 'Maths test', id, 'main' from public.categories;
insert into public.subtasks (task_id, title) select id, 'Past paper' from public.tasks;
select t.ok('owner can read own rows', t.cnt('select 1 from public.tasks') = 1 and t.cnt('select 1 from public.subtasks') = 1);
select t.su(); insert into t.ids select 'cat', id from public.categories; insert into t.ids select 'task', id from public.tasks;

select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select t.ok('other user reads none of Alice''s tasks/categories/subtasks', t.cnt('select 1 from public.tasks') + t.cnt('select 1 from public.categories') + t.cnt('select 1 from public.subtasks') = 0);
select t.ok('other user sees only own profile', t.cnt('select 1 from public.profiles') = 1);
select t.ok('other user cannot update Alice''s task', t.affected($$update public.tasks set title='pwned'$$) = 0);
select t.ok('other user cannot delete Alice''s task', t.affected($$delete from public.tasks$$) = 0);
select t.ok('other user cannot update Alice''s profile', t.affected($$update public.profiles set display_name='x' where id='aaaaaaaa-0000-0000-0000-000000000001'$$) = 0);
select t.fails('cannot insert a task owned by someone else', $$insert into public.tasks (user_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001','x')$$);
select t.fails('cannot attach own task to Alice''s category', $$insert into public.tasks (title, category_id) select 'x', v from t.ids where k='cat'$$);
select t.fails('cannot add subtask to Alice''s task', $$insert into public.subtasks (task_id, title) select v, 'x' from t.ids where k='task'$$);
select t.fails('invalid priority rejected', $$insert into public.tasks (title, priority) values ('x', 9)$$);
select t.fails('empty title rejected', $$insert into public.tasks (title) values ('')$$);
select t.fails('unknown status rejected', $$insert into public.tasks (title, status) values ('x','weird')$$);
select t.fails('unknown quest type rejected', $$insert into public.tasks (title, quest_type) values ('x','epic')$$);
select t.fails('estimate below 5 minutes rejected', $$insert into public.tasks (title, est_minutes) values ('x', 1)$$);
select t.fails('bad category color rejected', $$insert into public.categories (name, color) values ('c','red')$$);
select t.fails('invalid timezone rejected', $$update public.profiles set timezone='Mars/Base'$$);
select t.ok('valid IANA timezone accepted', t.affected($$update public.profiles set timezone='Europe/London'$$) = 1);
select t.fails('oversized theme JSON rejected', $$update public.preferences set theme = jsonb_build_object('x', repeat('a', 3000))$$);
select t.ok('clients cannot delete their profile row', t.affected($$delete from public.profiles$$) = 0);

select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select t.fails('cannot reassign own task to another user', $$update public.tasks set user_id='bbbbbbbb-0000-0000-0000-000000000002'$$);
update public.tasks set status = 'done';
select t.ok('completing a task stamps completed_at', (select completed_at is not null from public.tasks));
select t.su(); create temp table stamp as select completed_at c from public.tasks; grant all on stamp to public;
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.tasks set completed_at = '2001-01-01', title = 'Maths test (edited)';
select t.ok('forged completed_at is ignored', (select completed_at = (select c from stamp) from public.tasks));
update public.tasks set status = 'todo';
select t.ok('reopening clears completed_at', (select completed_at is null from public.tasks));
insert into public.tasks (title, status, completed_at) values ('d','done','2001-01-01');
select t.ok('inserting as already-done stamps server time, not the client value', (select completed_at > '2020-01-01' from public.tasks where title='d'));

select t.as_anon();
select t.fails('anonymous role cannot read tasks', 'select * from public.tasks');
select t.fails('anonymous role cannot read profiles', 'select * from public.profiles');
select t.fails('anonymous role cannot insert categories', $$insert into public.categories (name) values ('x')$$);

select t.su(); delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok('deleting a user cascades all their data', (select count(*) from public.tasks) + (select count(*) from public.categories) + (select count(*) from public.subtasks) + (select count(*) from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000001') = 0);

\i :root/tests/db/rls2.sql
\i :root/tests/db/rls3.sql
\i :root/tests/db/rls4.sql
\i :root/tests/db/rls5.sql
