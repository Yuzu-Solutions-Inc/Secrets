begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
      and c.relname not like 'drizzle%'
  ),
  'every public application table has RLS enabled'
);

insert into public.profiles (id, email, display_name) values
  ('10000000-0000-0000-0000-000000000001', 'admin@example.test', 'Admin'),
  ('10000000-0000-0000-0000-000000000002', 'alice@example.test', 'Alice'),
  ('10000000-0000-0000-0000-000000000003', 'bob@example.test', 'Bob');
insert into public.organizations (id, name, slug, created_by)
values ('20000000-0000-0000-0000-000000000001', 'Test House', 'test-house', '10000000-0000-0000-0000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'player'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'player');
insert into public.games (id, organization_id, title, public_code, created_by)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Test Game', 'TESTCODE', '10000000-0000-0000-0000-000000000001');
insert into public.game_players (id, game_id, user_id) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003');
insert into public.secrets (id, game_id, value, status) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Alice secret', 'locked'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Bob secret', 'locked');
insert into public.secret_holders (secret_id, player_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002');
insert into public.hints (id, secret_id, kind, text, position) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'text', 'Alice hint', 0),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'text', 'Bob hint', 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select is((select count(*) from public.secrets), 1::bigint, 'player sees only their own locked secret');
select is((select value from public.secrets), 'Alice secret', 'player receives their own secret value');
select is((select count(*) from public.hints), 0::bigint, 'ungranted hints never enter player payloads');
select is((select count(*) from public.wallets where kind = 'house'), 0::bigint, 'player cannot read the house wallet');
select is((select count(*) from public.ballots), 0::bigint, 'player cannot inspect other ballots');

reset role;
insert into public.hint_grants (hint_id, player_id, scope, source)
values ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'private', 'test');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.hints), 1::bigint, 'player sees only a granted hint');
select is((select text from public.hints), 'Bob hint', 'granted hint content is visible');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.secrets), 2::bigint, 'admin sees all game secrets');
select ok(public.is_game_admin('30000000-0000-0000-0000-000000000001'), 'admin helper recognizes game admin');
select ok(not public.is_game_player('30000000-0000-0000-0000-000000000001'), 'admin is not silently treated as a player');

select * from finish();
rollback;
