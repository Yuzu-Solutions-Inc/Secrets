-- A single hint row can now carry text and an image together (closes the
-- batch-4 gap — it used to split "both" into two deck entries). The row keeps
-- kind = 'text' when it has any text; renderers key off column presence, so
-- player_vault now also reports whether each hint has an image.
-- Whole function reproduced; only 'has_image' is new.

create or replace function public.player_vault(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select id from public.game_players
    where game_id = p_game_id and user_id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'secret', coalesce((
      select jsonb_build_object('has', true, 'status', s.status)
      from public.secret_holders sh
      join public.secrets s on s.id = sh.secret_id
      where sh.player_id = (select id from me) and s.game_id = p_game_id
      limit 1
    ), jsonb_build_object('has', false, 'status', null)),
    'missions', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'instructions', m.instructions,
        'status', m.status,
        'reward', m.reward,
        'penalty', m.penalty,
        'visibility', m.visibility,
        'submitted_at', ma.submitted_at
      ))
      from public.mission_assignments ma
      join public.missions m on m.id = ma.mission_id
      left join public.team_members tm on tm.team_id = ma.team_id
      where m.game_id = p_game_id
        and (ma.player_id = (select id from me) or tm.player_id = (select id from me))
    ), '[]'::jsonb),
    'hints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'kind', h.kind,
        'text', h.text,
        'has_image', h.asset_path is not null,
        'position', h.position,
        'about_player_id', ogp.id,
        'about_player_name', op.display_name,
        'source', case when hg.hint_id is not null then 'granted' else 'revealed' end
      ) order by op.display_name, h.position)
      from public.hints h
      join public.secret_holders owner on owner.secret_id = h.secret_id
      join public.game_players ogp on ogp.id = owner.player_id
      join public.profiles op on op.id = ogp.user_id
      join public.secrets s on s.id = h.secret_id
      left join public.hint_grants hg on hg.hint_id = h.id and hg.player_id = (select id from me)
      where ogp.game_id = p_game_id
        and (hg.hint_id is not null or s.status = 'revealed')
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_player_id', tn.target_player_id,
        'body', tn.body,
        'updated_at', tn.updated_at
      ))
      from public.theory_notes tn
      where tn.game_id = p_game_id and tn.player_id = (select id from me)
        and tn.target_player_id is not null
    ), '[]'::jsonb),
    'accusations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_player_id', ab.target_player_id,
        'theory', ab.theory,
        'status', ab.status,
        'created_at', ab.created_at,
        'resolved_at', ab.resolved_at
      ) order by ab.created_at desc)
      from public.accusation_buzzes ab
      where ab.game_id = p_game_id and ab.accuser_player_id = (select id from me)
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gp.id,
        'user_id', gp.user_id,
        'name', p.display_name,
        'avatar_path', p.avatar_path,
        'secret_revealed', coalesce(sr.revealed, false),
        'secret_text', sr.value,
        'hint_count', coalesce(hc.n, 0)
      ) order by p.display_name)
      from public.game_players gp
      join public.profiles p on p.id = gp.user_id
      left join lateral (
        select bool_or(s.status = 'revealed') as revealed,
               max(s.value) filter (where s.status = 'revealed') as value
        from public.secret_holders sh
        join public.secrets s on s.id = sh.secret_id
        where sh.player_id = gp.id and s.game_id = p_game_id
      ) sr on true
      left join lateral (
        select count(distinct h.id) as n
        from public.hints h
        join public.secret_holders owner on owner.secret_id = h.secret_id
        join public.secrets s on s.id = h.secret_id
        left join public.hint_grants hg on hg.hint_id = h.id and hg.player_id = (select id from me)
        where owner.player_id = gp.id
          and (hg.hint_id is not null or s.status = 'revealed')
      ) hc on true
      where gp.game_id = p_game_id and gp.id <> (select id from me)
    ), '[]'::jsonb),
    'house', (
      select jsonb_build_object(
        'id', hs.id,
        'revealed', hs.revealed_at is not null,
        'answer', case when hs.revealed_at is not null then hs.answer else null end,
        'note', (
          select tn.body
          from public.theory_notes tn
          where tn.game_id = p_game_id
            and tn.player_id = (select id from me)
            and tn.target_house_secret_id = hs.id
          limit 1
        )
      )
      from public.house_secrets hs
      where hs.game_id = p_game_id
    )
  )
  where exists (select 1 from me);
$$;
grant execute on function public.player_vault(uuid) to authenticated;
