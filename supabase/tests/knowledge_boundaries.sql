-- Admin/Player knowledge-boundary coverage for the tables that carry the most
-- sensitive per-player state: missions, dilemma choices, theory notes, House
-- Secret theories, ballots and the money ledger. Complements secrets_rls.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixture (inserted as the migration/superuser role, so RLS is bypassed here).
-- Wallets and starting-cash ledger rows are created by triggers on games /
-- game_players / teams, so we never insert them by hand.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'admin@example.test', 'Admin'),
  ('11111111-0000-0000-0000-000000000002', 'alice@example.test', 'Alice'),
  ('11111111-0000-0000-0000-000000000003', 'bob@example.test',   'Bob'),
  ('11111111-0000-0000-0000-000000000004', 'carol@example.test', 'Carol');

insert into public.organizations (id, name, slug, created_by)
values ('22222222-0000-0000-0000-000000000001', 'Boundary House', 'boundary-house',
        '11111111-0000-0000-0000-000000000001');

insert into public.organization_members (organization_id, user_id, role) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'admin'),
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'player'),
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', 'player'),
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004', 'player');

insert into public.games (id, organization_id, title, public_code, status, created_by)
values ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
        'Boundary Game', 'KB-TESTCODE', 'live', '11111111-0000-0000-0000-000000000001');

insert into public.game_players (id, game_id, user_id) values
  ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003');

insert into public.game_rounds (id, game_id, title, kind, position, config)
values ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
        'Round One', 'team', 0, '{}'::jsonb);

insert into public.teams (id, round_id, name)
values ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Red');

insert into public.team_members (team_id, player_id, dilemma_choice) values
  ('66666666-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'share'),
  ('66666666-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', 'steal');

insert into public.missions (id, game_id, title, instructions, visibility) values
  ('99999999-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'Public mission',  'Do it openly', 'public'),
  ('99999999-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 'Private mission', 'For Bob only',  'private');

insert into public.mission_assignments (mission_id, player_id)
values ('99999999-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003');

insert into public.theory_notes (game_id, player_id, body) values
  ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'alice-note'),
  ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', 'bob-note');

insert into public.house_secrets (id, game_id, answer)
values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'the butler');

insert into public.house_secret_submissions (house_secret_id, player_id, theory) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'alice theory'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', 'bob theory');

insert into public.ballots (round_id, voter_player_id, target_player_id, kind) values
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003', 'nominate'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', 'nominate');

-- ---------------------------------------------------------------------------
-- Alice: an ordinary player on the Red team.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', true);

select is((select count(*) from public.missions), 1::bigint,
  'player sees the public mission but not another player''s private mission');
select is((select visibility::text from public.missions), 'public',
  'the only mission a player sees is the public one');
select is((select count(*) from public.mission_assignments), 0::bigint,
  'player with no assignment sees no assignment rows');
select is((select count(*) from public.theory_notes), 1::bigint,
  'theory notes never cross between players');
select is((select body from public.theory_notes), 'alice-note',
  'player reads back only their own theory note');
select is((select count(*) from public.house_secret_submissions), 1::bigint,
  'House Secret theories stay private to their author');
select is((select count(*) from public.ballots), 1::bigint,
  'a voter sees only their own ballot');
select is((select count(*) from public.ballots where voter_player_id = '44444444-0000-0000-0000-000000000003'), 0::bigint,
  'a voter cannot read another player''s ballot');
select is((select count(*) from public.wallets where kind = 'house'), 0::bigint,
  'players cannot read the house wallet');
select is((select count(*) from public.wallets where player_id = '44444444-0000-0000-0000-000000000003'), 0::bigint,
  'players cannot read another player''s wallet');
select is((select count(*) from public.wallets), 2::bigint,
  'player still sees their own personal wallet and their team wallet');
select is((select count(*) from public.ledger_transactions), 0::bigint,
  'ledger transaction headers are host-only');
select is((select count(*) from public.ledger_entries), 1::bigint,
  'player sees only the ledger entry that touches their own wallet');
select is((select count(*) from public.team_members), 1::bigint,
  'a teammate''s dilemma choice is not in the player payload');
select is((select count(*) from public.game_rounds), 1::bigint,
  'a participant can see the game rounds');

-- ---------------------------------------------------------------------------
-- Carol: an organization member who never joined this game.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000004', true);
select is((select count(*) from public.team_members), 0::bigint,
  'a non-participant cannot read any team dilemma choices');
select is((select count(*) from public.missions), 0::bigint,
  'a public mission still requires being in the game');

-- ---------------------------------------------------------------------------
-- Bob: the player the private mission is assigned to.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000003', true);
select is((select count(*) from public.missions), 2::bigint,
  'the assigned player sees the private mission plus the public one');
select is((select count(*) from public.mission_assignments), 1::bigint,
  'the assigned player sees their own assignment');
select is((select count(*) from public.house_secret_submissions), 1::bigint,
  'Bob sees only his own House Secret theory');

-- ---------------------------------------------------------------------------
-- Admin: organization admin, therefore game host.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', true);
select ok(public.is_game_admin('33333333-0000-0000-0000-000000000001'),
  'an organization admin is recognized as the game host');
select is((select count(*) from public.ledger_transactions), 2::bigint,
  'the host can audit every ledger transaction');
select is((select count(*) from public.missions), 2::bigint,
  'the host sees every mission');
select is((select count(*) from public.house_secret_submissions), 2::bigint,
  'the host sees every House Secret theory');
select is((select count(*) from public.ballots), 2::bigint,
  'the host can audit every ballot');
select is((select count(*) from public.theory_notes), 0::bigint,
  'private theory notes stay hidden even from the host');

select * from finish();
rollback;
