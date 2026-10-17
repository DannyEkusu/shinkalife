-- READ-ONLY checks. They create, change and delete nothing. Paste ONE query at a time into Supabase > SQL Editor and press Run
-- (the editor only shows the result of the last statement). Anything showing present = false is missing.

-- QUERY 1: which tables / functions exist, and which migration creates each
select t.migration, t.kind, t.name,
       case t.kind when 'table' then to_regclass('public.' || t.name) is not null
                   else to_regprocedure('public.' || t.name) is not null end as present
from (values
  ('0001','table','profiles'),('0001','table','preferences'),
  ('0002','table','categories'),('0002','table','tasks'),('0002','table','subtasks'),
  ('0003','table','availability'),('0003','table','events'),('0003','table','event_exceptions'),('0003','table','schedule_blocks'),
  ('0003','table','planner_drafts'),('0003','table','reminder_settings'),('0003','table','push_subscriptions'),('0003','table','weekly_reviews'),
  ('0004','table','xp_ledger'),('0004','table','achievements_unlocked'),('0004','function','award_task_xp(uuid)'),
  ('0006','table','reminders'),('0006','table','ai_usage'),('0006','function','ai_consume(uuid,integer)')
) as t(migration, kind, name)
order by t.migration, t.kind, t.name;

-- QUERY 2: is the signup trigger installed? (expect true after 0001)
select exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') as signup_trigger_present;

-- QUERY 3 (run after the migrations): every table should show rls_enabled = true and at least 1 policy
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;

-- QUERY 4 (after 0004): who may run the XP function? expect anon_can_run = false, signed_in_can_run = true
select has_function_privilege('anon', 'public.award_task_xp(uuid)', 'execute') as anon_can_run,
       has_function_privilege('authenticated', 'public.award_task_xp(uuid)', 'execute') as signed_in_can_run;

-- QUERY 5 (after 0001 + 0005): accounts that still have no profile row (expect 0)
select count(*) as accounts_without_profile
from auth.users u left join public.profiles p on p.id = u.id where p.id is null;

-- QUERY 6 (after 0006): the new columns exist? expect exactly 3 rows (assistant_name, ai_opt_in, muted_categories)
select table_name, column_name from information_schema.columns
where table_schema = 'public' and ((table_name = 'preferences' and column_name in ('assistant_name', 'ai_opt_in')) or (table_name = 'reminder_settings' and column_name = 'muted_categories'))
order by 1, 2;

-- QUERY 7 (after 0006): who may run the AI usage counter? expect anon_can_run = false, signed_in_can_run = false, server_can_run = true
-- (Query 3 will show ai_usage with 0 policies. That is correct: RLS on + no policy = nobody but the server can touch it.)
select has_function_privilege('anon', 'public.ai_consume(uuid,integer)', 'execute') as anon_can_run,
       has_function_privilege('authenticated', 'public.ai_consume(uuid,integer)', 'execute') as signed_in_can_run,
       has_function_privilege('service_role', 'public.ai_consume(uuid,integer)', 'execute') as server_can_run;
