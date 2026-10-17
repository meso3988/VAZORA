-- ============================================================================
-- PRODUCTION READ-ONLY PRECHECK (for SQL Editor in project goahenvdlxvrvuhblvne)
--
-- Strictly read-only:
--   * Explicit BEGIN TRANSACTION READ ONLY ... ROLLBACK transaction boundaries
--   * Bounded lock_timeout (3s) and statement_timeout (10s) via SET LOCAL
--   * No CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / GRANT / REVOKE
--   * Never calls record_obligation_cycle_settlement, void_obligation_cycle_settlement,
--     or any sweep function
--   * Checks supabase_migrations.schema_migrations existence before reading it
--   * Compares actual catalog definitions (full policy set and full function
--     overload set including signatures and return types) against the final
--     tested 0015 file
--     (SHA-256: eaf8148b1b0e50de6f0c11d6b5796dd0d6dd2be7ab9ab6ed7002b2712650b03b)
--   * Returns schema/definition/privilege/count metadata only — no secrets,
--     no contract content, no client or organization names
-- ============================================================================

begin transaction read only;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

with checks as (
  -- 1. Transaction & environment safety check
  select 1 as ord,
         '1_environment' as check_name,
         (current_setting('transaction_read_only') = 'on')::text as matches_expected,
         jsonb_build_object(
           'postgres_version', current_setting('server_version'),
           'transaction_read_only', current_setting('transaction_read_only'),
           'lock_timeout', current_setting('lock_timeout'),
           'statement_timeout', current_setting('statement_timeout'),
           'now_utc', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS"Z"')
         )::text as actual_state

  union all

  -- 2. Migration history table (checked via to_regclass before reading via query_to_xml)
  select 2,
         '2_migration_history',
         case
           when to_regclass('supabase_migrations.schema_migrations') is null then 'table_absent'
           else 'table_present'
         end,
         case
           when to_regclass('supabase_migrations.schema_migrations') is null then
             'ABSENT: table supabase_migrations.schema_migrations does not exist'
           else
             coalesce(
               (select 'PRESENT: versions=' || coalesce(string_agg(x, ' ' order by x), 'empty')
                  from unnest(
                    xpath(
                      '/table/row/version/text()',
                      query_to_xml('select version from supabase_migrations.schema_migrations order by version', true, false, '')
                    )::text[]
                  ) as x),
               'PRESENT: empty'
             )
         end

  union all

  -- 3. 0015 enum + table columns & defaults
  select 3,
         '3_0015_enum_and_columns',
         (
           to_regclass('public.obligation_cycle_settlements') is not null
           and coalesce((
             select jsonb_agg(e.enumlabel order by e.enumsortorder)
               from pg_type t
               join pg_enum e on e.enumtypid = t.oid
               join pg_namespace n on n.oid = t.typnamespace
              where n.nspname = 'public' and t.typname = 'obligation_cycle_settlement_status'
           ), '[]'::jsonb) = '["active", "voided"]'::jsonb
           and coalesce((
             select jsonb_agg(
               c.column_name || ':' || c.udt_name
               || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end
               || case when c.column_default is not null then ' DEFAULT ' || c.column_default else '' end
               order by c.ordinal_position
             )
             from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'obligation_cycle_settlements'
           ), '[]'::jsonb) = jsonb_build_array(
             'id:uuid NOT NULL DEFAULT gen_random_uuid()',
             'organization_id:uuid NOT NULL',
             'obligation_id:uuid NOT NULL',
             'cycle_due_date:date NOT NULL',
             'completed_on:date',
             'note:text NOT NULL',
             'evidence_item_id:uuid',
             'evidence_version_id:uuid',
             'recorded_by:uuid NOT NULL',
             'recorded_at:timestamptz NOT NULL DEFAULT now()',
             'status:obligation_cycle_settlement_status NOT NULL DEFAULT ''active''::obligation_cycle_settlement_status',
             'voided_by:uuid',
             'voided_at:timestamptz',
             'void_reason:text'
           )
         )::text,
         jsonb_build_object(
           'enum_values', (
             select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), 'null'::jsonb)
               from pg_type t
               join pg_enum e on e.enumtypid = t.oid
               join pg_namespace n on n.oid = t.typnamespace
              where n.nspname = 'public' and t.typname = 'obligation_cycle_settlement_status'
           ),
           'table_exists', to_regclass('public.obligation_cycle_settlements') is not null,
           'columns', (
             select coalesce(
               jsonb_agg(
                 c.column_name || ':' || c.udt_name
                 || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end
                 || case when c.column_default is not null then ' DEFAULT ' || c.column_default else '' end
                 order by c.ordinal_position
               ),
               'null'::jsonb
             )
             from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'obligation_cycle_settlements'
           ),
           'row_count', case
             when to_regclass('public.obligation_cycle_settlements') is null then null
             else (xpath('/table/row/c/text()', query_to_xml('select count(*) as c from public.obligation_cycle_settlements', true, false, '')))[1]::text::bigint
           end
         )::text

  union all

  -- 4. 0015 table constraints (PK + 2 CHECK constraints + 6 FKs, verified by definition)
  select 4,
         '4_0015_constraints',
         (
           to_regclass('public.obligation_cycle_settlements') is not null
           and coalesce((
             select jsonb_agg(con.conname || ':' || con.contype::text || ':' || con.convalidated::text || ':' || pg_get_constraintdef(con.oid, true) order by con.contype, con.conname)
               from pg_constraint con
              where con.conrelid = to_regclass('public.obligation_cycle_settlements')
           ), '[]'::jsonb) = jsonb_build_array(
             'obligation_cycle_settlements_note_check:c:true:CHECK (length(btrim(note)) >= 1 AND length(btrim(note)) <= 1000)',
             'settlement_void_shape:c:true:CHECK (status = ''active''::obligation_cycle_settlement_status AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL OR status = ''voided''::obligation_cycle_settlement_status AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND length(btrim(void_reason)) >= 1 AND length(btrim(void_reason)) <= 1000)',
             'obligation_cycle_settlements_evidence_item_id_fkey:f:true:FOREIGN KEY (evidence_item_id) REFERENCES evidence_items(id) ON DELETE SET NULL',
             'obligation_cycle_settlements_evidence_version_id_fkey:f:true:FOREIGN KEY (evidence_version_id) REFERENCES evidence_versions(id) ON DELETE SET NULL',
             'obligation_cycle_settlements_obligation_id_fkey:f:true:FOREIGN KEY (obligation_id) REFERENCES contract_obligations(id) ON DELETE CASCADE',
             'obligation_cycle_settlements_organization_id_fkey:f:true:FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
             'obligation_cycle_settlements_recorded_by_fkey:f:true:FOREIGN KEY (recorded_by) REFERENCES auth.users(id)',
             'obligation_cycle_settlements_voided_by_fkey:f:true:FOREIGN KEY (voided_by) REFERENCES auth.users(id)',
             'obligation_cycle_settlements_pkey:p:true:PRIMARY KEY (id)'
           )
         )::text,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'name', con.conname,
                       'type', con.contype,
                       'validated', con.convalidated,
                       'def', pg_get_constraintdef(con.oid, true)
                     )
                     order by con.contype, con.conname
                   )::text
              from pg_constraint con
             where con.conrelid = to_regclass('public.obligation_cycle_settlements')),
           'table_missing'
         )

  union all

  -- 5. 0015 indexes (definitions, partial WHERE predicates, uniqueness, validity)
  select 5,
         '5_0015_indexes',
         (
           coalesce((
             select jsonb_agg(pg_get_indexdef(i.indexrelid) order by c.relname)
               from pg_index i
               join pg_class c on c.oid = i.indexrelid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in (
                  'obligation_cycle_settlements_one_active',
                  'obligation_cycle_settlements_org_obligation',
                  'officer_sweep_runs_one_running'
                )
                and i.indisvalid and i.indisready and i.indislive
           ), '[]'::jsonb) = jsonb_build_array(
             'CREATE UNIQUE INDEX obligation_cycle_settlements_one_active ON public.obligation_cycle_settlements USING btree (obligation_id, cycle_due_date) WHERE (status = ''active''::obligation_cycle_settlement_status)',
             'CREATE INDEX obligation_cycle_settlements_org_obligation ON public.obligation_cycle_settlements USING btree (organization_id, obligation_id)',
             'CREATE UNIQUE INDEX officer_sweep_runs_one_running ON public.officer_sweep_runs USING btree (organization_id) WHERE (status = ''running''::officer_sweep_status)'
           )
         )::text,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'index', c.relname,
                       'on_table', t.relname,
                       'unique', i.indisunique,
                       'valid', i.indisvalid,
                       'ready', i.indisready,
                       'live', i.indislive,
                       'def', pg_get_indexdef(i.indexrelid)
                     )
                     order by c.relname
                   )::text
              from pg_index i
              join pg_class c on c.oid = i.indexrelid
              join pg_class t on t.oid = i.indrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public'
               and c.relname in (
                 'obligation_cycle_settlements_one_active',
                 'obligation_cycle_settlements_org_obligation',
                 'officer_sweep_runs_one_running'
               )),
           '[]'
         )

  union all

  -- 6. RLS status & full policy set on obligation_cycle_settlements
  --    Compares the entire policy set (name, cmd, permissive, roles, qual, with_check)
  --    so any extra SELECT/INSERT/UPDATE/DELETE policy makes matches_expected = false.
  select 6,
         '6_0015_rls_and_policies',
         (
           coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.obligation_cycle_settlements')), false)
           and coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'policy', policyname,
                        'cmd', cmd,
                        'permissive', permissive,
                        'roles', to_jsonb(roles),
                        'qual', qual,
                        'with_check', with_check
                      )
                      order by policyname, cmd
                    )
               from pg_policies
              where schemaname = 'public' and tablename = 'obligation_cycle_settlements'
           ), '[]'::jsonb) = jsonb_build_array(
             jsonb_build_object(
               'policy', 'obligation_cycle_settlements_select',
               'cmd', 'SELECT',
               'permissive', 'PERMISSIVE',
               'roles', to_jsonb(array['public']::name[]),
               'qual', 'is_org_member(organization_id)',
               'with_check', null
             )
           )
         )::text,
         case
           when to_regclass('public.obligation_cycle_settlements') is null then 'table_missing'
           else jsonb_build_object(
             'rls_enabled', (select relrowsecurity from pg_class where oid = to_regclass('public.obligation_cycle_settlements')),
             'rls_forced', (select relforcerowsecurity from pg_class where oid = to_regclass('public.obligation_cycle_settlements')),
             'policies', coalesce(
               (select jsonb_agg(
                         jsonb_build_object(
                           'policy', policyname,
                           'cmd', cmd,
                           'permissive', permissive,
                           'roles', to_jsonb(roles),
                           'qual', qual,
                           'with_check', with_check
                         )
                         order by policyname, cmd
                       )
                  from pg_policies
                 where schemaname = 'public' and tablename = 'obligation_cycle_settlements'),
               '[]'::jsonb
             )
           )::text
         end

  union all

  -- 7. Actual table grants for anon & authenticated on obligation_cycle_settlements (96d7f43 check)
  select 7,
         '7_0015_table_grants',
         (
           to_regclass('public.obligation_cycle_settlements') is not null
           and not has_table_privilege('anon', 'public.obligation_cycle_settlements', 'SELECT')
           and not has_table_privilege('anon', 'public.obligation_cycle_settlements', 'INSERT')
           and has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'SELECT')
           and not has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'INSERT')
           and not has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'UPDATE')
           and not has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'DELETE')
         )::text,
         case
           when to_regclass('public.obligation_cycle_settlements') is null then 'table_missing'
           else jsonb_build_object(
             'role_table_grants', coalesce(
               (select jsonb_agg(grantee || ':' || privilege_type order by grantee, privilege_type)
                  from information_schema.role_table_grants
                 where table_schema = 'public'
                   and table_name = 'obligation_cycle_settlements'
                   and grantee in ('anon', 'authenticated', 'PUBLIC')),
               '[]'::jsonb
             ),
             'anon_select', has_table_privilege('anon', 'public.obligation_cycle_settlements', 'SELECT'),
             'anon_insert', has_table_privilege('anon', 'public.obligation_cycle_settlements', 'INSERT'),
             'authenticated_select', has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'SELECT'),
             'authenticated_insert', has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'INSERT'),
             'authenticated_update', has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'UPDATE'),
             'authenticated_delete', has_table_privilege('authenticated', 'public.obligation_cycle_settlements', 'DELETE')
           )::text
         end

  union all

  -- 8. 0015 functions: full overload set compared (name, identity args, return type,
  --    security_definer, search_path, body SHA-256, and execute privileges for anon/public/authenticated)
  select 8,
         '8_0015_functions',
         (
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'name', p.proname,
                        'args', pg_get_function_identity_arguments(p.oid),
                        'returns', pg_get_function_result(p.oid),
                        'security_definer', p.prosecdef,
                        'config', to_jsonb(p.proconfig),
                        'prosrc_sha256', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex'),
                        'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
                        'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                        'public_can_execute', has_function_privilege('public', p.oid, 'EXECUTE')
                      )
                      order by p.proname, pg_get_function_identity_arguments(p.oid)
                    )
               from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('record_obligation_cycle_settlement', 'void_obligation_cycle_settlement')
           ), '[]'::jsonb) = jsonb_build_array(
             jsonb_build_object(
               'name', 'record_obligation_cycle_settlement',
               'args', 'p_obligation_id uuid, p_cycle_due_date date, p_completed_on date, p_note text, p_evidence_item_id uuid, p_evidence_version_id uuid',
               'returns', 'uuid',
               'security_definer', true,
               'config', to_jsonb(array['search_path=public']::text[]),
               'prosrc_sha256', '2565039b885959a77eba8c78b2c09336c6ca36a5a48ef0d7b17d980d8920ff11',
               'anon_can_execute', false,
               'authenticated_can_execute', true,
               'public_can_execute', false
             ),
             jsonb_build_object(
               'name', 'void_obligation_cycle_settlement',
               'args', 'p_settlement_id uuid, p_reason text',
               'returns', 'void',
               'security_definer', true,
               'config', to_jsonb(array['search_path=public']::text[]),
               'prosrc_sha256', '4aabd2af387122e258471306ec2cfac530e8b39a03b139758b9e81647c0e0e44',
               'anon_can_execute', false,
               'authenticated_can_execute', true,
               'public_can_execute', false
             )
           )
         )::text,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'name', p.proname,
                       'args', pg_get_function_identity_arguments(p.oid),
                       'returns', pg_get_function_result(p.oid),
                       'security_definer', p.prosecdef,
                       'config', to_jsonb(p.proconfig),
                       'prosrc_sha256', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex'),
                       'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
                       'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                       'public_can_execute', has_function_privilege('public', p.oid, 'EXECUTE')
                     )
                     order by p.proname, pg_get_function_identity_arguments(p.oid)
                   )::text
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('record_obligation_cycle_settlement', 'void_obligation_cycle_settlement')),
           '[]'
         )

  union all

  -- 9. Sweep runs state (counts and timestamps only — no organization/contract data)
  select 9,
         '9_sweep_runs_state',
         (
           (select count(*) from public.officer_sweep_runs
             where status = 'running' and started_at >= now() - interval '15 minutes') = 0
         )::text,
         jsonb_build_object(
           'running_over_15m_would_become_failed', (
             select count(*) from public.officer_sweep_runs
              where status = 'running' and started_at < now() - interval '15 minutes'
           ),
           'running_active_within_15m', (
             select count(*) from public.officer_sweep_runs
              where status = 'running' and started_at >= now() - interval '15 minutes'
           ),
           'orgs_with_multiple_running_rows', (
             select count(*) from (
               select organization_id from public.officer_sweep_runs
                where status = 'running'
                group by organization_id having count(*) > 1
             ) d
           ),
           'oldest_running_started_at', (
             select to_char(min(started_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS"Z"')
               from public.officer_sweep_runs where status = 'running'
           ),
           'newest_running_started_at', (
             select to_char(max(started_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS"Z"')
               from public.officer_sweep_runs where status = 'running'
           )
         )::text
)
select ord, check_name, matches_expected, actual_state
  from checks
 order by ord;

rollback;
