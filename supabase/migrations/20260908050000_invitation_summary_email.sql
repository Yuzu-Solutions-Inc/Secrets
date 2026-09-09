-- invitation_summary now also returns the invited email so the invite page can
-- verify the signed-in user matches before offering the "Join the game" button
-- (previously an email mismatch only surfaced as a 500 from accept_invitation).
drop function if exists public.invitation_summary(text);

create or replace function public.invitation_summary(p_token_hash text)
returns table (organization_name text, game_title text, invited_email text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, g.title, i.email, i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.games g on g.id = i.game_id
  where i.token_hash = p_token_hash
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  limit 1;
$$;
grant execute on function public.invitation_summary(text) to anon, authenticated;
