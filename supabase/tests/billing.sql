begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.profiles (id, email, display_name) values
  ('aa000000-0000-0000-0000-000000000001', 'admin-a@example.test', 'Admin A'),
  ('aa000000-0000-0000-0000-000000000002', 'admin-b@example.test', 'Admin B'),
  ('bb000000-0000-0000-0000-000000000002', 'p2@example.test', 'P2'),
  ('bb000000-0000-0000-0000-000000000003', 'p3@example.test', 'P3'),
  ('bb000000-0000-0000-0000-000000000004', 'p4@example.test', 'P4'),
  ('bb000000-0000-0000-0000-000000000005', 'p5@example.test', 'P5'),
  ('bb000000-0000-0000-0000-000000000006', 'p6@example.test', 'P6');

insert into public.organizations (id, name, slug, created_by) values
  ('a0000000-0000-0000-0000-000000000001', 'Org A', 'org-a', 'aa000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'Org B', 'org-b', 'aa000000-0000-0000-0000-000000000002');
insert into public.organization_members (organization_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000002', 'admin');

insert into public.entitlements (user_id, plan, pro_credits, free_pro_game_used) values
  ('aa000000-0000-0000-0000-000000000001', 'free', 0, false),
  ('aa000000-0000-0000-0000-000000000002', 'free', 0, true);

-- ── create_game() clamps the Free tier ─────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.create_game(
  'a0000000-0000-0000-0000-000000000001', 'Free 1', 'weekend', 1000000, 'fr', 'FREE1', 'free',
  '{"sharedSecrets": true, "imageHints": true}'::jsonb
);
reset role;

select is((select format from public.games where public_code = 'FREE1'), 'quick', 'free game format is forced to quick');
select is((select settings ->> 'tier' from public.games where public_code = 'FREE1'), 'free', 'free game is stamped tier=free');
select is((select settings ->> 'maxPlayers' from public.games where public_code = 'FREE1'), '5', 'free game is capped at 5 players');

-- ── First round 1 spends the free trial ───────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.create_game('a0000000-0000-0000-0000-000000000001', 'Pro 1', 'quick', 1000000, 'fr', 'PRO1', 'pro', '{}'::jsonb);
reset role;
insert into public.game_rounds (game_id, title, kind, status, position, config)
select id, 'R1', 'solo', 'scheduled', 0, '{}'::jsonb from public.games where public_code = 'PRO1';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.host_transition((select id from public.games where public_code = 'PRO1'), 'next_round');
reset role;

select is((select free_pro_game_used from public.entitlements where user_id = 'aa000000-0000-0000-0000-000000000001'), true, 'free trial is marked used');
select is((select pro_games_started from public.entitlements where user_id = 'aa000000-0000-0000-0000-000000000001'), 1, 'pro_games_started incremented');
select is((select settings ->> 'proGameSource' from public.games where public_code = 'PRO1'), 'free_trial', 'game records the free_trial source');

-- ── A pack credit is spent on start and refunded on a 0-round completion ───
update public.entitlements
set plan = 'pro_pack', pro_credits = 2, pro_expires_at = now() + interval '1 year'
where user_id = 'aa000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.create_game('a0000000-0000-0000-0000-000000000001', 'Pro 2', 'quick', 1000000, 'fr', 'PRO2', 'pro', '{}'::jsonb);
reset role;
insert into public.game_rounds (game_id, title, kind, status, position, config)
select id, 'R1', 'solo', 'scheduled', 0, '{}'::jsonb from public.games where public_code = 'PRO2';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.host_transition((select id from public.games where public_code = 'PRO2'), 'next_round');
reset role;
select is((select pro_credits from public.entitlements where user_id = 'aa000000-0000-0000-0000-000000000001'), 1, 'pack credit consumed at start');
select is((select settings ->> 'creditConsumed' from public.games where public_code = 'PRO2'), 'true', 'game flags the consumed credit');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.host_transition((select id from public.games where public_code = 'PRO2'), 'complete');
reset role;
select is((select pro_credits from public.entitlements where user_id = 'aa000000-0000-0000-0000-000000000001'), 2, 'credit refunded when no round ran');
select is((select settings ->> 'creditRefunded' from public.games where public_code = 'PRO2'), 'true', 'game flags the refund');

-- ── 10th Pro game queues a sharing review ────────────────────────────────
update public.entitlements
set plan = 'pro_unlimited', pro_credits = 0, pro_games_started = 9, pro_expires_at = now() + interval '1 year'
where user_id = 'aa000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.create_game('a0000000-0000-0000-0000-000000000001', 'Pro 3', 'quick', 1000000, 'fr', 'PRO3', 'pro', '{}'::jsonb);
reset role;
insert into public.game_rounds (game_id, title, kind, status, position, config)
select id, 'R1', 'solo', 'scheduled', 0, '{}'::jsonb from public.games where public_code = 'PRO3';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.host_transition((select id from public.games where public_code = 'PRO3'), 'next_round');
reset role;
select is(
  (select count(*) from public.billing_review_queue
   where user_id = 'aa000000-0000-0000-0000-000000000001' and milestone = 10),
  1::bigint,
  '10th Pro game inserts a billing_review_queue row'
);

-- ── Player cap trigger blocks the 6th player on a Free game ──────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select public.create_game('a0000000-0000-0000-0000-000000000001', 'Free Cap', 'quick', 1000000, 'fr', 'FREECAP', 'free', '{}'::jsonb);
reset role;
insert into public.game_players (game_id, user_id)
select id, u from public.games g,
  (values ('bb000000-0000-0000-0000-000000000002'::uuid),
          ('bb000000-0000-0000-0000-000000000003'::uuid),
          ('bb000000-0000-0000-0000-000000000004'::uuid),
          ('bb000000-0000-0000-0000-000000000005'::uuid)) as extra(u)
where g.public_code = 'FREECAP';
select throws_ok(
  $$ insert into public.game_players (game_id, user_id)
     select id, 'bb000000-0000-0000-0000-000000000006' from public.games where public_code = 'FREECAP' $$,
  'player_cap_reached',
  'the 6th player on a Free game is rejected'
);

-- ── create_game('pro') without entitlement is refused ───────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.create_game('a0000000-0000-0000-0000-000000000002', 'Nope', 'quick', 1000, 'fr', 'ORGB1', 'pro', '{}'::jsonb) $$,
  'pro_entitlement_required',
  'a spent-out user cannot create a Pro game'
);
reset role;

select * from finish();
rollback;
