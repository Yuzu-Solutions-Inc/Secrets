-- Restores public.owns_game_player(uuid), a small pure helper ("is the
-- current user this game_players row?") originally added in
-- 20260909120000_fix_rls_recursion.sql. It's missing from at least one
-- environment (dropped out-of-band at some point, outside the tracked
-- migration history, along with several sibling helpers from that same
-- file) even though that migration is recorded as applied — 20261002091000
-- (player wallet transaction history for players) depends on it and fails
-- to deploy without it. Idempotent and side-effect free: no policies or
-- other objects reference this definition today, so recreating it here is
-- safe regardless of which environment applies it.

create or replace function public.owns_game_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_players
    where id = p_player_id and user_id = auth.uid()
  );
$$;
grant execute on function public.owns_game_player(uuid) to authenticated;
