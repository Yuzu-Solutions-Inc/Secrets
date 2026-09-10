-- Secret-bank hint decks (item 21 cont.). Each secret_bank entry gets an
-- ordered deck of up to 10 hints, bought one at a time in-game. Hints never
-- name the answer, and the deck is shaped as a slow reveal with misdirection:
--   pos 0-1  fog. A mood and an abstract emoji that fit dozens of secrets;
--            the buyer should feel lost.
--   pos 2-4  a scene or detail that invites a theory - and deliberately
--            supports a plausible WRONG story, not just the true one.
--   pos 5-7  correction. The decoy reading stops fitting; the real mechanism
--            comes into view.
--   pos 8-9  disambiguation. A sharp player lands it with a leap, but no hint
--            states it outright.
--
-- Three hint kinds:
--   text   - a sentence (authored per locale)
--   emoji  - a short emoji sequence (locale-independent; stored on both the
--            en and fr bank rows so either language game gets it)
--   image  - a reference into a free, no-attribution icon set. Format
--            '<set>:<name>', e.g. 'lucide:git-merge'. lucide-react (ISC) is
--            already a dependency. Rendered client-side; see the renderer
--            follow-up note at the bottom of this file.
--
-- fill_bank_secrets() is updated to copy a picked secret's deck into the
-- game's own hints table. Idempotent (on conflict do nothing).

-- ---------------------------------------------------------------------------
-- 1. secret_bank_hints
-- ---------------------------------------------------------------------------

create table if not exists public.secret_bank_hints (
  id uuid primary key default gen_random_uuid(),
  secret_bank_id uuid not null references public.secret_bank(id) on delete cascade,
  position integer not null,
  kind text not null default 'text',
  text text,
  image_ref text,
  created_at timestamptz not null default now(),
  constraint secret_bank_hints_position_range check (position >= 0 and position < 10),
  constraint secret_bank_hints_kind check (kind in ('text', 'emoji', 'image')),
  constraint secret_bank_hints_content check (
    (kind in ('text', 'emoji') and text is not null and image_ref is null) or
    (kind = 'image' and image_ref is not null and text is null)
  )
);

create unique index if not exists secret_bank_hints_deck
  on public.secret_bank_hints (secret_bank_id, position);

alter table public.secret_bank_hints enable row level security;

-- Prompt content, same posture as secret_bank: any signed-in user may read.
drop policy if exists secret_bank_hints_read on public.secret_bank_hints;
create policy secret_bank_hints_read on public.secret_bank_hints
  for select to authenticated using (true);

grant select on public.secret_bank_hints to authenticated;

-- ---------------------------------------------------------------------------
-- 2. hints.image_ref  (per-game hints can now point at a bundled icon instead
--    of an uploaded storage asset)
-- ---------------------------------------------------------------------------

alter table public.hints add column if not exists image_ref text;

alter table public.hints drop constraint if exists hint_has_content;
alter table public.hints add constraint hint_has_content
  check (text is not null or asset_path is not null or image_ref is not null);

-- ---------------------------------------------------------------------------
-- 3. fill_bank_secrets() - now also copies the picked secret's hint deck
-- ---------------------------------------------------------------------------

create or replace function public.fill_bank_secrets(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.game_status;
  v_category text;
  v_locale text;
  v_player record;
  v_bank_id uuid;
  v_pick text;
  v_secret uuid;
  v_count integer := 0;
begin
  if not public.is_game_admin(p_game_id) then raise exception 'forbidden'; end if;

  select status,
         coalesce(nullif(settings->>'secretCategory', ''), 'mixed'),
         coalesce(nullif(settings->>'language', ''), 'fr')
    into v_status, v_category, v_locale
    from public.games where id = p_game_id;

  if v_status in ('completed', 'archived') then raise exception 'secrets_locked'; end if;

  for v_player in
    select gp.id
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.play_status = 'active'
      and not exists (
        select 1
        from public.secret_holders sh
        join public.secrets s on s.id = sh.secret_id
        where sh.player_id = gp.id and s.game_id = p_game_id
      )
  loop
    v_bank_id := null;
    v_pick := null;

    select b.id, b.text into v_bank_id, v_pick
    from public.secret_bank b
    where (v_category = 'mixed' or b.category = v_category)
      and b.locale = v_locale
    order by random()
    limit 1;

    -- Fall back to any locale, then any category, so a thin bank still works.
    if v_pick is null then
      select b.id, b.text into v_bank_id, v_pick from public.secret_bank b
      where (v_category = 'mixed' or b.category = v_category)
      order by random() limit 1;
    end if;
    if v_pick is null then
      select b.id, b.text into v_bank_id, v_pick from public.secret_bank b
      order by random() limit 1;
    end if;
    if v_pick is null then raise exception 'secret_bank_empty'; end if;

    insert into public.secrets (game_id, value, status)
    values (
      p_game_id,
      v_pick,
      case when v_status in ('draft', 'secret_submission') then 'draft' else 'locked' end::public.secret_status
    )
    returning id into v_secret;
    insert into public.secret_holders (secret_id, player_id) values (v_secret, v_player.id);

    -- Copy the bank deck into the game's hints.
    insert into public.hints (secret_id, kind, text, asset_path, image_ref, position, default_price)
    select v_secret,
           case when h.kind = 'image' then 'image' else 'text' end::public.hint_kind,
           h.text,
           null,
           h.image_ref,
           h.position,
           0
    from public.secret_bank_hints h
    where h.secret_bank_id = v_bank_id
    order by h.position;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
grant execute on function public.fill_bank_secrets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Decks
--    Matched to secret_bank rows by (category, locale, text). Each block is
--    one secret: its en + fr bank rows, then the 10 ordered hints. emoji /
--    image hints carry identical content on the en and fr rows.
-- ---------------------------------------------------------------------------

-- family :: "My grandparents were second cousins." ---------------------------
with s as (
  select b.id, m.handle, m.locale
  from public.secret_bank b
  join (values
    ('fam-second-cousins', 'family', 'en', 'My grandparents were second cousins.'),
    ('fam-second-cousins', 'family', 'fr', 'Mes grands-parents étaient cousins au second degré.')
  ) as m(handle, category, locale, secret_text)
    on m.category = b.category and m.locale = b.locale and m.secret_text = b.text
)
insert into public.secret_bank_hints (secret_bank_id, position, kind, text, image_ref)
select s.id, h.position, h.kind, h.text, h.image_ref
from s
join (values
  ('fam-second-cousins', 'en', 0, 'text',  'There is a fact about how my family came to exist that we just do not bring up.'::text, null::text),
  ('fam-second-cousins', 'en', 1, 'emoji', '🤫🌳', null),
  ('fam-second-cousins', 'en', 2, 'text',  'It goes back to two people in a photo on my grandparents'' mantel.', null),
  ('fam-second-cousins', 'en', 3, 'emoji', '💍😬', null),
  ('fam-second-cousins', 'en', 4, 'text',  'When my grandparents got together, one side of the family was far less surprised than the other.', null),
  ('fam-second-cousins', 'en', 5, 'text',  'They did not really "meet" — they had been at the same birthdays and funerals for years.', null),
  ('fam-second-cousins', 'en', 6, 'image', null, 'lucide:git-merge'),
  ('fam-second-cousins', 'en', 7, 'text',  'Their mothers grew up going to the same family reunions.', null),
  ('fam-second-cousins', 'en', 8, 'emoji', '🧬👨‍👩‍👧‍👦♻️', null),
  ('fam-second-cousins', 'en', 9, 'text',  'The rule for how many "cousins removed" you have to be before you can marry — we know it by heart.', null),
  ('fam-second-cousins', 'fr', 0, 'text',  'Il y a un fait sur la façon dont ma famille est née qu''on n''aborde jamais.', null),
  ('fam-second-cousins', 'fr', 1, 'emoji', '🤫🌳', null),
  ('fam-second-cousins', 'fr', 2, 'text',  'Ça remonte à deux personnes sur une photo posée chez mes grands-parents.', null),
  ('fam-second-cousins', 'fr', 3, 'emoji', '💍😬', null),
  ('fam-second-cousins', 'fr', 4, 'text',  'Quand mes grands-parents se sont mis ensemble, un côté de la famille a été bien moins surpris que l''autre.', null),
  ('fam-second-cousins', 'fr', 5, 'text',  'Ils ne se sont pas vraiment « rencontrés » — ils allaient aux mêmes anniversaires et enterrements depuis des années.', null),
  ('fam-second-cousins', 'fr', 6, 'image', null, 'lucide:git-merge'),
  ('fam-second-cousins', 'fr', 7, 'text',  'Leurs mères ont grandi en allant aux mêmes réunions de famille.', null),
  ('fam-second-cousins', 'fr', 8, 'emoji', '🧬👨‍👩‍👧‍👦♻️', null),
  ('fam-second-cousins', 'fr', 9, 'text',  'La règle du nombre de degrés de cousinage pour pouvoir se marier — on la connaît par cœur.', null)
) as h(handle, locale, position, kind, text, image_ref)
  on h.handle = s.handle and h.locale = s.locale
on conflict (secret_bank_id, position) do nothing;

-- family pack A (seed 1) ---------------------------------------------------
-- emoji / image hints carry locale '*' and match either language row.
with s as (
  select b.id, m.handle, m.locale
  from public.secret_bank b
  join (values
    ('fam-cook-calls',       'family', 'en', 'I still phone a parent to ask how to cook basic meals.'),
    ('fam-cook-calls',       'family', 'fr', 'J''appelle encore un parent pour savoir comment cuire des pâtes.'),
    ('fam-fav-sibling',      'family', 'en', 'I have a favourite sibling and they know it.'),
    ('fam-fav-sibling',      'family', 'fr', 'J''ai un frère ou une sœur préféré et il le sait.'),
    ('fam-regift-return',    'family', 'en', 'I once regifted a present back to the person who gave it to me.'),
    ('fam-regift-return',    'family', 'fr', 'J''ai déjà réoffert un cadeau à la personne qui me l''avait donné.'),
    ('fam-lose-on-purpose',  'family', 'en', 'I lose board games on purpose against the youngest cousins.'),
    ('fam-lose-on-purpose',  'family', 'fr', 'Je perds exprès aux jeux de société contre les plus jeunes cousins.'),
    ('fam-unfinished-book',  'family', 'en', 'I have never finished a book my family told me to read.'),
    ('fam-unfinished-book',  'family', 'fr', 'Je n''ai jamais fini un livre conseillé par ma famille.'),
    ('fam-groupchat-lurker', 'family', 'en', 'I read the family group chat every day and never reply.'),
    ('fam-groupchat-lurker', 'family', 'fr', 'Je lis le groupe familial chaque jour sans jamais répondre.'),
    ('fam-pet-blame',        'family', 'en', 'I broke a family heirloom and let the pet take the blame.'),
    ('fam-pet-blame',        'family', 'fr', 'J''ai cassé un objet de famille et laissé l''animal porter le blâme.'),
    ('fam-recipe-refuse',    'family', 'en', 'I know a family recipe and refuse to share it.'),
    ('fam-recipe-refuse',    'family', 'fr', 'Je connais une recette de famille et je refuse de la partager.'),
    ('fam-slipped-money',    'family', 'en', 'I still get money slipped to me by a relative.'),
    ('fam-slipped-money',    'family', 'fr', 'Un proche me glisse encore de l''argent en cachette.'),
    ('fam-fake-work-trip',   'family', 'en', 'I skipped a family reunion by inventing a work trip.'),
    ('fam-fake-work-trip',   'family', 'fr', 'J''ai raté une réunion de famille en inventant un voyage de travail.')
  ) as m(handle, category, locale, secret_text)
    on m.category = b.category and m.locale = b.locale and m.secret_text = b.text
)
insert into public.secret_bank_hints (secret_bank_id, position, kind, text, image_ref)
select s.id, h.position, h.kind, h.text, h.image_ref
from s
join (values
  ('fam-cook-calls', '*',  1, 'emoji', '📞🍳'::text, null::text),
  ('fam-cook-calls', '*',  3, 'emoji', '🍝❓', null),
  ('fam-cook-calls', '*',  6, 'image', null, 'lucide:phone'),
  ('fam-cook-calls', '*',  8, 'emoji', '🧑‍🍳➡️📱👵', null),
  ('fam-cook-calls', 'en', 0, 'text', 'There is a phone call I make that I would not want on speakerphone.', null),
  ('fam-cook-calls', 'en', 2, 'text', 'It happens in my own kitchen, in my own home, as a grown adult.', null),
  ('fam-cook-calls', 'en', 4, 'text', 'You might think we just talk a lot.', null),
  ('fam-cook-calls', 'en', 5, 'text', 'It is not really a chat. It is step-by-step instructions.', null),
  ('fam-cook-calls', 'en', 7, 'text', '"How long do I boil this for" is a text I have sent this month.', null),
  ('fam-cook-calls', 'en', 9, 'text', 'I still call a parent to walk me through cooking basic meals.', null),
  ('fam-cook-calls', 'fr', 0, 'text', 'Il y a un appel que je passe et que je ne mettrais pas sur haut-parleur.', null),
  ('fam-cook-calls', 'fr', 2, 'text', 'Ça se passe dans ma propre cuisine, chez moi, en adulte.', null),
  ('fam-cook-calls', 'fr', 4, 'text', 'Tu pourrais croire qu''on discute juste beaucoup.', null),
  ('fam-cook-calls', 'fr', 5, 'text', 'Ce n''est pas vraiment une discussion. Ce sont des instructions, étape par étape.', null),
  ('fam-cook-calls', 'fr', 7, 'text', '« Je le fais bouillir combien de temps » est un message que j''ai envoyé ce mois-ci.', null),
  ('fam-cook-calls', 'fr', 9, 'text', 'J''appelle encore un parent pour qu''il me guide pour cuisiner des plats de base.', null),

  ('fam-fav-sibling', '*',  1, 'emoji', '🥇👨‍👦', null),
  ('fam-fav-sibling', '*',  3, 'emoji', '⚖️😏', null),
  ('fam-fav-sibling', '*',  6, 'image', null, 'lucide:heart'),
  ('fam-fav-sibling', '*',  8, 'emoji', '👧👦👦➡️❤️👦', null),
  ('fam-fav-sibling', 'en', 0, 'text', 'There is a ranking in my family we do not pretend does not exist.', null),
  ('fam-fav-sibling', 'en', 2, 'text', 'Among the people I grew up with, one gets more of me than the others.', null),
  ('fam-fav-sibling', 'en', 4, 'text', 'You would assume this is kept quiet.', null),
  ('fam-fav-sibling', 'en', 5, 'text', 'It is not. The person in question knows, and enjoys it.', null),
  ('fam-fav-sibling', 'en', 7, 'text', 'Birthdays, phone calls, the better gift — it is not spread evenly and we all know why.', null),
  ('fam-fav-sibling', 'en', 9, 'text', 'I have a favourite sibling and they know they are the favourite.', null),
  ('fam-fav-sibling', 'fr', 0, 'text', 'Il y a un classement dans ma famille qu''on ne fait pas semblant d''ignorer.', null),
  ('fam-fav-sibling', 'fr', 2, 'text', 'Parmi les gens avec qui j''ai grandi, un reçoit plus de moi que les autres.', null),
  ('fam-fav-sibling', 'fr', 4, 'text', 'Tu supposerais que ça reste discret.', null),
  ('fam-fav-sibling', 'fr', 5, 'text', 'Non. La personne concernée le sait, et ça lui plaît.', null),
  ('fam-fav-sibling', 'fr', 7, 'text', 'Anniversaires, appels, le meilleur cadeau — ce n''est pas réparti également et on sait tous pourquoi.', null),
  ('fam-fav-sibling', 'fr', 9, 'text', 'J''ai un frère ou une sœur préféré et il sait qu''il l''est.', null),

  ('fam-regift-return', '*',  1, 'emoji', '🎁🔄', null),
  ('fam-regift-return', '*',  3, 'emoji', '🤦🎀', null),
  ('fam-regift-return', '*',  6, 'image', null, 'lucide:gift'),
  ('fam-regift-return', '*',  8, 'emoji', '🎁➡️🧑➡️🎁', null),
  ('fam-regift-return', 'en', 0, 'text', 'I once closed a full circle with a wrapped present.', null),
  ('fam-regift-return', 'en', 2, 'text', 'Something I was given, I later gave to someone else.', null),
  ('fam-regift-return', 'en', 4, 'text', 'Regifting is normal. This was a particular case.', null),
  ('fam-regift-return', 'en', 5, 'text', 'The person opening it had wrapped it for me the year before.', null),
  ('fam-regift-return', 'en', 7, 'text', 'They recognised their own handwriting on the little card.', null),
  ('fam-regift-return', 'en', 9, 'text', 'I regifted a present straight back to the person who first gave it to me.', null),
  ('fam-regift-return', 'fr', 0, 'text', 'J''ai une fois bouclé une boucle complète avec un cadeau emballé.', null),
  ('fam-regift-return', 'fr', 2, 'text', 'Ce qu''on m''avait offert, je l''ai ensuite offert à quelqu''un d''autre.', null),
  ('fam-regift-return', 'fr', 4, 'text', 'Réoffrir un cadeau, c''est normal. Là, c''était un cas particulier.', null),
  ('fam-regift-return', 'fr', 5, 'text', 'La personne qui l''ouvrait me l''avait emballé l''année d''avant.', null),
  ('fam-regift-return', 'fr', 7, 'text', 'Elle a reconnu sa propre écriture sur la petite carte.', null),
  ('fam-regift-return', 'fr', 9, 'text', 'J''ai réoffert un cadeau directement à la personne qui me l''avait offert au départ.', null),

  ('fam-lose-on-purpose', '*',  1, 'emoji', '🎲🤫', null),
  ('fam-lose-on-purpose', '*',  3, 'emoji', '🏆❓', null),
  ('fam-lose-on-purpose', '*',  6, 'image', null, 'lucide:dice-5'),
  ('fam-lose-on-purpose', '*',  8, 'emoji', '🎲👦👧➡️🏆', null),
  ('fam-lose-on-purpose', 'en', 0, 'text', 'At family game night I follow a private rule I never announce.', null),
  ('fam-lose-on-purpose', 'en', 2, 'text', 'There is a group of players I make sure never to beat.', null),
  ('fam-lose-on-purpose', 'en', 4, 'text', 'People think I am just unlucky with the dice.', null),
  ('fam-lose-on-purpose', 'en', 5, 'text', 'I am not unlucky. I fold good hands and miss easy moves on purpose.', null),
  ('fam-lose-on-purpose', 'en', 7, 'text', 'The smallest people at the table always seem to win when I am playing.', null),
  ('fam-lose-on-purpose', 'en', 9, 'text', 'I throw every board game on purpose so the youngest cousins can win.', null),
  ('fam-lose-on-purpose', 'fr', 0, 'text', 'Au soir de jeux en famille, je suis une règle perso que je n''annonce jamais.', null),
  ('fam-lose-on-purpose', 'fr', 2, 'text', 'Il y a un groupe de joueurs que je m''arrange pour ne jamais battre.', null),
  ('fam-lose-on-purpose', 'fr', 4, 'text', 'Les gens croient que je suis juste malchanceux aux dés.', null),
  ('fam-lose-on-purpose', 'fr', 5, 'text', 'Je ne suis pas malchanceux. Je jette de bonnes mains et je rate des coups faciles exprès.', null),
  ('fam-lose-on-purpose', 'fr', 7, 'text', 'Les plus petits de la table gagnent toujours quand je joue.', null),
  ('fam-lose-on-purpose', 'fr', 9, 'text', 'Je perds exprès à tous les jeux de société pour que les plus jeunes cousins gagnent.', null),

  ('fam-unfinished-book', '*',  1, 'emoji', '📖🚫', null),
  ('fam-unfinished-book', '*',  3, 'emoji', '🔖😬', null),
  ('fam-unfinished-book', '*',  6, 'image', null, 'lucide:book'),
  ('fam-unfinished-book', '*',  8, 'emoji', '📚👨‍👩‍👧➡️🙅', null),
  ('fam-unfinished-book', 'en', 0, 'text', 'There is a conversation I have been faking my way through for years.', null),
  ('fam-unfinished-book', 'en', 2, 'text', 'A book keeps coming up at family dinners and I nod along.', null),
  ('fam-unfinished-book', 'en', 4, 'text', 'It is not that I do not read.', null),
  ('fam-unfinished-book', 'en', 5, 'text', 'This one specific book, pressed on me by relatives, I have never finished.', null),
  ('fam-unfinished-book', 'en', 7, 'text', 'I have seen the film, skimmed the ending, and can hold a whole conversation about it.', null),
  ('fam-unfinished-book', 'en', 9, 'text', 'I have never actually finished the book my family is sure I have read.', null),
  ('fam-unfinished-book', 'fr', 0, 'text', 'Il y a une conversation que je bluffe depuis des années.', null),
  ('fam-unfinished-book', 'fr', 2, 'text', 'Un livre revient sans cesse aux repas de famille et je hoche la tête.', null),
  ('fam-unfinished-book', 'fr', 4, 'text', 'Ce n''est pas que je ne lis pas.', null),
  ('fam-unfinished-book', 'fr', 5, 'text', 'Ce livre précis, que des proches m''ont mis dans les mains, je ne l''ai jamais fini.', null),
  ('fam-unfinished-book', 'fr', 7, 'text', 'J''ai vu le film, survolé la fin, et je peux en parler sans problème.', null),
  ('fam-unfinished-book', 'fr', 9, 'text', 'Je n''ai jamais vraiment fini le livre que ma famille est sûre que j''ai lu.', null),

  ('fam-groupchat-lurker', '*',  1, 'emoji', '💬👀', null),
  ('fam-groupchat-lurker', '*',  3, 'emoji', '📱🤐', null),
  ('fam-groupchat-lurker', '*',  6, 'image', null, 'lucide:message-circle'),
  ('fam-groupchat-lurker', '*',  8, 'emoji', '👨‍👩‍👧‍👦💬➡️👁️', null),
  ('fam-groupchat-lurker', 'en', 0, 'text', 'There is a room full of my relatives I visit every day and never speak in.', null),
  ('fam-groupchat-lurker', 'en', 2, 'text', 'I know everything that is going on. I contribute nothing.', null),
  ('fam-groupchat-lurker', 'en', 4, 'text', 'They probably think my notifications are off.', null),
  ('fam-groupchat-lurker', 'en', 5, 'text', 'I read every single message, usually within a minute.', null),
  ('fam-groupchat-lurker', 'en', 7, 'text', 'Birthdays, arguments, holiday plans — I follow all of it in total silence.', null),
  ('fam-groupchat-lurker', 'en', 9, 'text', 'I read the family group chat every day and have never once replied.', null),
  ('fam-groupchat-lurker', 'fr', 0, 'text', 'Il y a une pièce pleine de mes proches où je passe chaque jour sans jamais parler.', null),
  ('fam-groupchat-lurker', 'fr', 2, 'text', 'Je sais tout ce qui se passe. Je n''apporte rien.', null),
  ('fam-groupchat-lurker', 'fr', 4, 'text', 'Ils croient sûrement que mes notifications sont coupées.', null),
  ('fam-groupchat-lurker', 'fr', 5, 'text', 'Je lis chaque message, en général dans la minute.', null),
  ('fam-groupchat-lurker', 'fr', 7, 'text', 'Anniversaires, disputes, plans de vacances — je suis tout ça en silence total.', null),
  ('fam-groupchat-lurker', 'fr', 9, 'text', 'Je lis le groupe familial chaque jour et je n''ai jamais répondu une seule fois.', null),

  ('fam-pet-blame', '*',  1, 'emoji', '🏺🐾', null),
  ('fam-pet-blame', '*',  3, 'emoji', '🐈😼', null),
  ('fam-pet-blame', '*',  6, 'image', null, 'lucide:cat'),
  ('fam-pet-blame', '*',  8, 'emoji', '🙋💥🏺➡️🐈🫵', null),
  ('fam-pet-blame', 'en', 0, 'text', 'Something breakable and irreplaceable met its end on my watch.', null),
  ('fam-pet-blame', 'en', 2, 'text', 'There was a loud crash and a very quick decision about what had happened.', null),
  ('fam-pet-blame', 'en', 4, 'text', 'The family version of the story involves four legs and a tail.', null),
  ('fam-pet-blame', 'en', 5, 'text', 'The animal was nowhere near it. I just pointed.', null),
  ('fam-pet-blame', 'en', 7, 'text', 'A pet got the scolding for something my elbow did.', null),
  ('fam-pet-blame', 'en', 9, 'text', 'I broke a family heirloom and let the pet take the blame.', null),
  ('fam-pet-blame', 'fr', 0, 'text', 'Un objet fragile et irremplaçable a connu sa fin sous ma responsabilité.', null),
  ('fam-pet-blame', 'fr', 2, 'text', 'Il y a eu un grand fracas et une décision très rapide sur ce qui s''était passé.', null),
  ('fam-pet-blame', 'fr', 4, 'text', 'La version familiale de l''histoire implique quatre pattes et une queue.', null),
  ('fam-pet-blame', 'fr', 5, 'text', 'L''animal était à l''autre bout de la pièce. J''ai juste pointé du doigt.', null),
  ('fam-pet-blame', 'fr', 7, 'text', 'Un animal s''est fait gronder pour ce que mon coude a fait.', null),
  ('fam-pet-blame', 'fr', 9, 'text', 'J''ai cassé un objet de famille et laissé l''animal porter le blâme.', null),

  ('fam-recipe-refuse', '*',  1, 'emoji', '🍲🔒', null),
  ('fam-recipe-refuse', '*',  3, 'emoji', '📝🙅', null),
  ('fam-recipe-refuse', '*',  6, 'image', null, 'lucide:utensils'),
  ('fam-recipe-refuse', '*',  8, 'emoji', '👩‍🍳📜➡️🙅‍♀️', null),
  ('fam-recipe-refuse', 'en', 0, 'text', 'I hold something the rest of the family actively wants from me.', null),
  ('fam-recipe-refuse', 'en', 2, 'text', 'At least twice a year someone asks me for it, directly.', null),
  ('fam-recipe-refuse', 'en', 4, 'text', 'They suspect I have forgotten it and am too proud to admit it.', null),
  ('fam-recipe-refuse', 'en', 5, 'text', 'I remember it perfectly. I just say no.', null),
  ('fam-recipe-refuse', 'en', 7, 'text', 'Cousins have offered actual money for it and I have turned them down.', null),
  ('fam-recipe-refuse', 'en', 9, 'text', 'I know a family recipe by heart and flatly refuse to pass it on.', null),
  ('fam-recipe-refuse', 'fr', 0, 'text', 'Je détiens une chose que le reste de la famille veut activement de moi.', null),
  ('fam-recipe-refuse', 'fr', 2, 'text', 'Au moins deux fois par an, quelqu''un me la demande, directement.', null),
  ('fam-recipe-refuse', 'fr', 4, 'text', 'Ils soupçonnent que je l''ai oubliée et que je suis trop fier pour l''avouer.', null),
  ('fam-recipe-refuse', 'fr', 5, 'text', 'Je m''en souviens parfaitement. Je dis juste non.', null),
  ('fam-recipe-refuse', 'fr', 7, 'text', 'Des cousins m''ont proposé de l''argent pour l''avoir et j''ai refusé.', null),
  ('fam-recipe-refuse', 'fr', 9, 'text', 'Je connais une recette de famille par cœur et je refuse catégoriquement de la transmettre.', null),

  ('fam-slipped-money', '*',  1, 'emoji', '💵🤫', null),
  ('fam-slipped-money', '*',  3, 'emoji', '👵👛', null),
  ('fam-slipped-money', '*',  6, 'image', null, 'lucide:banknote'),
  ('fam-slipped-money', '*',  8, 'emoji', '👵➡️💶➡️🧑', null),
  ('fam-slipped-money', 'en', 0, 'text', 'Every time I say goodbye to one relative, there is a small ritual.', null),
  ('fam-slipped-money', 'en', 2, 'text', 'Something changes hands by the front door, folded, never discussed.', null),
  ('fam-slipped-money', 'en', 4, 'text', 'You might assume I am short on money.', null),
  ('fam-slipped-money', 'en', 5, 'text', 'It is not about need. It is a habit they never dropped.', null),
  ('fam-slipped-money', 'en', 7, 'text', 'I am a full adult and someone still presses notes into my hand "for the journey".', null),
  ('fam-slipped-money', 'en', 9, 'text', 'A relative still slips me money in secret, as if I were nine.', null),
  ('fam-slipped-money', 'fr', 0, 'text', 'Chaque fois que je dis au revoir à un proche, il y a un petit rituel.', null),
  ('fam-slipped-money', 'fr', 2, 'text', 'Quelque chose change de mains près de la porte, plié, jamais évoqué.', null),
  ('fam-slipped-money', 'fr', 4, 'text', 'Tu pourrais supposer que je manque d''argent.', null),
  ('fam-slipped-money', 'fr', 5, 'text', 'Ce n''est pas une question de besoin. C''est une habitude qu''il n''a jamais lâchée.', null),
  ('fam-slipped-money', 'fr', 7, 'text', 'Je suis un adulte fait et quelqu''un me glisse encore des billets dans la main « pour la route ».', null),
  ('fam-slipped-money', 'fr', 9, 'text', 'Un proche me glisse encore de l''argent en cachette, comme si j''avais neuf ans.', null),

  ('fam-fake-work-trip', '*',  1, 'emoji', '✈️🙅', null),
  ('fam-fake-work-trip', '*',  3, 'emoji', '💼🤥', null),
  ('fam-fake-work-trip', '*',  6, 'image', null, 'lucide:briefcase'),
  ('fam-fake-work-trip', '*',  8, 'emoji', '👨‍👩‍👧‍👦🎉➡️🧑💼✈️', null),
  ('fam-fake-work-trip', 'en', 0, 'text', 'One year a whole side of the family gathered and I engineered a reason to be elsewhere.', null),
  ('fam-fake-work-trip', 'en', 2, 'text', 'I had a clash of plans that day. I also created that clash.', null),
  ('fam-fake-work-trip', 'en', 4, 'text', 'Everyone thinks my job pulled me away.', null),
  ('fam-fake-work-trip', 'en', 5, 'text', 'My job did not pull me away. I told it to.', null),
  ('fam-fake-work-trip', 'en', 7, 'text', 'I booked a fake trip, set an out-of-office, and stayed home.', null),
  ('fam-fake-work-trip', 'en', 9, 'text', 'I invented a work trip to get out of a family reunion.', null),
  ('fam-fake-work-trip', 'fr', 0, 'text', 'Une année, tout un côté de la famille s''est réuni et j''ai fabriqué une raison d''être ailleurs.', null),
  ('fam-fake-work-trip', 'fr', 2, 'text', 'J''avais un conflit d''agenda ce jour-là. J''avais aussi créé ce conflit.', null),
  ('fam-fake-work-trip', 'fr', 4, 'text', 'Tout le monde croit que mon travail m''a retenu.', null),
  ('fam-fake-work-trip', 'fr', 5, 'text', 'Mon travail ne m''a pas retenu. Je le lui ai demandé.', null),
  ('fam-fake-work-trip', 'fr', 7, 'text', 'J''ai réservé un faux voyage, activé une réponse d''absence, et je suis resté chez moi.', null),
  ('fam-fake-work-trip', 'fr', 9, 'text', 'J''ai inventé un voyage de travail pour échapper à une réunion de famille.', null)
) as h(handle, locale, position, kind, text, image_ref)
  on h.handle = s.handle and (h.locale = s.locale or h.locale = '*')
on conflict (secret_bank_id, position) do nothing;

-- family pack B (seed 2) ---------------------------------------------------
with s as (
  select b.id, m.handle, m.locale
  from public.secret_bank b
  join (values
    ('fam-half-sibling',    'family', 'en', 'I found out as an adult that I have a half-sibling.'),
    ('fam-half-sibling',    'family', 'fr', 'J''ai appris adulte que j''ai un demi-frère ou une demi-sœur.'),
    ('fam-named-after-ex',  'family', 'en', 'I was named after my dad''s ex.'),
    ('fam-named-after-ex',  'family', 'fr', 'On m''a donné le prénom de l''ex de mon père.'),
    ('fam-heirloom-dog',    'family', 'en', 'I broke a family heirloom and blamed the dog for nine years.'),
    ('fam-heirloom-dog',    'family', 'fr', 'J''ai cassé un objet de famille et accusé le chien pendant neuf ans.'),
    ('fam-not-blood',       'family', 'en', 'I know which relative is not biologically related, and I have never said.'),
    ('fam-not-blood',       'family', 'fr', 'Je sais quel proche n''a aucun lien de sang avec nous et je ne l''ai jamais dit.'),
    ('fam-eloped-photos',   'family', 'en', 'My parents eloped and told everyone the wedding photos were lost.'),
    ('fam-eloped-photos',   'family', 'fr', 'Mes parents se sont mariés en cachette et ont dit que les photos étaient perdues.'),
    ('fam-conceived-trip',  'family', 'en', 'I was conceived on a trip my parents still swear they took separately.'),
    ('fam-conceived-trip',  'family', 'fr', 'J''ai été conçu pendant un voyage que mes parents jurent avoir fait séparément.'),
    ('fam-recipe-grave',    'family', 'en', 'There is a family recipe I have and will take to my grave.'),
    ('fam-recipe-grave',    'family', 'fr', 'Il y a une recette de famille que je détiens et que j''emporterai dans la tombe.'),
    ('fam-intercept-mail',  'family', 'en', 'I opened a relative''s mail for a year to hide a debt letter.'),
    ('fam-intercept-mail',  'family', 'fr', 'J''ai ouvert le courrier d''un proche pendant un an pour cacher une lettre de dettes.'),
    ('fam-fake-degree',     'family', 'en', 'My family thinks I finished a degree that I did not.'),
    ('fam-fake-degree',     'family', 'fr', 'Ma famille croit que j''ai terminé un diplôme que je n''ai pas.'),
    ('fam-funeral-cousin',  'family', 'en', 'I have a cousin I first met at a funeral in my thirties.'),
    ('fam-funeral-cousin',  'family', 'fr', 'J''ai un cousin que je n''ai rencontré qu''à un enterrement, la trentaine passée.')
  ) as m(handle, category, locale, secret_text)
    on m.category = b.category and m.locale = b.locale and m.secret_text = b.text
)
insert into public.secret_bank_hints (secret_bank_id, position, kind, text, image_ref)
select s.id, h.position, h.kind, h.text, h.image_ref
from s
join (values
  ('fam-half-sibling', '*',  1, 'emoji', '📧😳'::text, null::text),
  ('fam-half-sibling', '*',  3, 'emoji', '👨‍👧‍👦❓', null),
  ('fam-half-sibling', '*',  6, 'image', null, 'lucide:git-branch'),
  ('fam-half-sibling', '*',  8, 'emoji', '🧬➕1️⃣🙋', null),
  ('fam-half-sibling', 'en', 0, 'text', 'I once got an email that rearranged how I think about my dad.', null),
  ('fam-half-sibling', 'en', 2, 'text', 'For most of my life, one number was wrong: how many of us there are.', null),
  ('fam-half-sibling', 'en', 4, 'text', 'I used to be the oldest. It turns out that was a technicality.', null),
  ('fam-half-sibling', 'en', 5, 'text', 'Nobody exactly lied. They just never brought it up.', null),
  ('fam-half-sibling', 'en', 7, 'text', 'Somewhere there is a person with my dad''s laugh and a different surname.', null),
  ('fam-half-sibling', 'en', 9, 'text', 'I found out as a grown adult that our family photo was missing someone.', null),
  ('fam-half-sibling', 'fr', 0, 'text', 'J''ai un jour reçu un courriel qui a réorganisé ma façon de voir mon père.', null),
  ('fam-half-sibling', 'fr', 2, 'text', 'Presque toute ma vie, un chiffre a été faux : combien on est.', null),
  ('fam-half-sibling', 'fr', 4, 'text', 'J''étais l''aîné. Il s''avère que c''était un détail technique.', null),
  ('fam-half-sibling', 'fr', 5, 'text', 'Personne n''a vraiment menti. On n''en a juste jamais parlé.', null),
  ('fam-half-sibling', 'fr', 7, 'text', 'Quelque part, il y a une personne avec le rire de mon père et un autre nom de famille.', null),
  ('fam-half-sibling', 'fr', 9, 'text', 'J''ai appris, adulte, qu''il manquait quelqu''un sur la photo de famille.', null),

  ('fam-named-after-ex', '*',  1, 'emoji', '📛🙃', null),
  ('fam-named-after-ex', '*',  3, 'emoji', '💔👩', null),
  ('fam-named-after-ex', '*',  6, 'image', null, 'lucide:heart-crack'),
  ('fam-named-after-ex', '*',  8, 'emoji', '👨❤️‍🩹👩➡️📛', null),
  ('fam-named-after-ex', 'en', 0, 'text', 'There is a story behind my first name that my mum tells differently than my dad.', null),
  ('fam-named-after-ex', 'en', 2, 'text', 'My mum wanted a different name. She lost that one.', null),
  ('fam-named-after-ex', 'en', 4, 'text', 'For years I was told I was named after a great-aunt.', null),
  ('fam-named-after-ex', 'en', 5, 'text', 'The great-aunt explanation fell apart at a wedding when someone laughed.', null),
  ('fam-named-after-ex', 'en', 7, 'text', 'The name meant something to my dad before he ever met my mum.', null),
  ('fam-named-after-ex', 'en', 9, 'text', 'I am named after one of my dad''s exes.', null),
  ('fam-named-after-ex', 'fr', 0, 'text', 'Il y a une histoire derrière mon prénom que ma mère raconte autrement que mon père.', null),
  ('fam-named-after-ex', 'fr', 2, 'text', 'Ma mère voulait un autre prénom. Elle a perdu sur celui-là.', null),
  ('fam-named-after-ex', 'fr', 4, 'text', 'Pendant des années, on m''a dit que je portais le prénom d''une grand-tante.', null),
  ('fam-named-after-ex', 'fr', 5, 'text', 'L''explication de la grand-tante s''est effondrée à un mariage quand quelqu''un a ri.', null),
  ('fam-named-after-ex', 'fr', 7, 'text', 'Ce prénom signifiait quelque chose pour mon père avant même qu''il rencontre ma mère.', null),
  ('fam-named-after-ex', 'fr', 9, 'text', 'Je porte le prénom d''une ex de mon père.', null),

  ('fam-heirloom-dog', '*',  1, 'emoji', '🏺💥', null),
  ('fam-heirloom-dog', '*',  3, 'emoji', '🐶😳', null),
  ('fam-heirloom-dog', '*',  6, 'image', null, 'lucide:dog'),
  ('fam-heirloom-dog', '*',  8, 'emoji', '🐕‍🦺🙊🕘', null),
  ('fam-heirloom-dog', 'en', 0, 'text', 'There is a thing I broke that the family still brings up at dinner.', null),
  ('fam-heirloom-dog', 'en', 2, 'text', 'It was old, it mattered, and it was my fault.', null),
  ('fam-heirloom-dog', 'en', 4, 'text', 'Someone else took the blame for almost a decade.', null),
  ('fam-heirloom-dog', 'en', 5, 'text', 'That someone could not actually defend themselves.', null),
  ('fam-heirloom-dog', 'en', 7, 'text', 'The one who "did it" got shouted at and then handed a treat.', null),
  ('fam-heirloom-dog', 'en', 9, 'text', 'Nine years is a long time to let a dog carry something that was mine.', null),
  ('fam-heirloom-dog', 'fr', 0, 'text', 'Il y a une chose que j''ai cassée et que la famille ressort encore à table.', null),
  ('fam-heirloom-dog', 'fr', 2, 'text', 'C''était vieux, ça comptait, et c''était ma faute.', null),
  ('fam-heirloom-dog', 'fr', 4, 'text', 'Quelqu''un d''autre a porté le blâme pendant presque dix ans.', null),
  ('fam-heirloom-dog', 'fr', 5, 'text', 'Ce quelqu''un ne pouvait pas vraiment se défendre.', null),
  ('fam-heirloom-dog', 'fr', 7, 'text', 'Celui qui « l''avait fait » s''est fait crier dessus puis a reçu une friandise.', null),
  ('fam-heirloom-dog', 'fr', 9, 'text', 'Neuf ans, c''est long pour laisser un chien porter une chose qui était la mienne.', null),

  ('fam-not-blood', '*',  1, 'emoji', '🧬🤐', null),
  ('fam-not-blood', '*',  3, 'emoji', '👀👨‍👩‍👧‍👦', null),
  ('fam-not-blood', '*',  6, 'image', null, 'lucide:fingerprint'),
  ('fam-not-blood', '*',  8, 'emoji', '🌳🪡🤫', null),
  ('fam-not-blood', 'en', 0, 'text', 'I am holding a piece of family information that is not mine to hold.', null),
  ('fam-not-blood', 'en', 2, 'text', 'At reunions I look around and know something the group photo does not.', null),
  ('fam-not-blood', 'en', 4, 'text', 'There is a running joke about who someone "gets their height from". I do not laugh.', null),
  ('fam-not-blood', 'en', 5, 'text', 'It is not me. I checked that a long time ago.', null),
  ('fam-not-blood', 'en', 7, 'text', 'One branch of the tree is stitched on, not grown.', null),
  ('fam-not-blood', 'en', 9, 'text', 'I know exactly which relative is not blood-related, and I will never be the one to say it.', null),
  ('fam-not-blood', 'fr', 0, 'text', 'Je porte une information de famille qui n''est pas à moi de porter.', null),
  ('fam-not-blood', 'fr', 2, 'text', 'Aux réunions, je regarde autour et je sais une chose que la photo de groupe ignore.', null),
  ('fam-not-blood', 'fr', 4, 'text', 'Il y a une blague récurrente sur « de qui il tient sa taille ». Je ne ris pas.', null),
  ('fam-not-blood', 'fr', 5, 'text', 'Ce n''est pas moi. J''ai vérifié il y a longtemps.', null),
  ('fam-not-blood', 'fr', 7, 'text', 'Une branche de l''arbre est cousue dessus, pas poussée.', null),
  ('fam-not-blood', 'fr', 9, 'text', 'Je sais exactement quel proche n''a aucun lien de sang, et je ne serai jamais celui qui le dira.', null),

  ('fam-eloped-photos', '*',  1, 'emoji', '📷🕳️', null),
  ('fam-eloped-photos', '*',  3, 'emoji', '💒❌', null),
  ('fam-eloped-photos', '*',  6, 'image', null, 'lucide:plane'),
  ('fam-eloped-photos', '*',  8, 'emoji', '🏃‍♀️💍🤵‍♂️', null),
  ('fam-eloped-photos', 'en', 0, 'text', 'There is a set of photos my parents have been "looking for" my entire life.', null),
  ('fam-eloped-photos', 'en', 2, 'text', 'Every time the wedding comes up, the album is somewhere else.', null),
  ('fam-eloped-photos', 'en', 4, 'text', 'I used to think a flood got them.', null),
  ('fam-eloped-photos', 'en', 5, 'text', 'There was no flood. There was barely a wedding.', null),
  ('fam-eloped-photos', 'en', 7, 'text', 'Two witnesses, a courthouse, and a lunch afterward.', null),
  ('fam-eloped-photos', 'en', 9, 'text', 'The wedding photos are not lost. There simply are not any.', null),
  ('fam-eloped-photos', 'fr', 0, 'text', 'Il y a une série de photos que mes parents « cherchent » depuis toute ma vie.', null),
  ('fam-eloped-photos', 'fr', 2, 'text', 'Chaque fois que le mariage revient sur le tapis, l''album est ailleurs.', null),
  ('fam-eloped-photos', 'fr', 4, 'text', 'Je croyais qu''une inondation les avait emportées.', null),
  ('fam-eloped-photos', 'fr', 5, 'text', 'Il n''y a pas eu d''inondation. Il y a à peine eu un mariage.', null),
  ('fam-eloped-photos', 'fr', 7, 'text', 'Deux témoins, une mairie, et un déjeuner après.', null),
  ('fam-eloped-photos', 'fr', 9, 'text', 'Les photos du mariage ne sont pas perdues. Il n''y en a tout simplement aucune.', null),

  ('fam-conceived-trip', '*',  1, 'emoji', '🧮😬', null),
  ('fam-conceived-trip', '*',  3, 'emoji', '✈️👩✈️👨', null),
  ('fam-conceived-trip', '*',  6, 'image', null, 'lucide:calendar'),
  ('fam-conceived-trip', '*',  8, 'emoji', '🏖️🍷➡️👶', null),
  ('fam-conceived-trip', 'en', 0, 'text', 'There is a bit of family history where the dates do not line up and nobody wants to do the maths.', null),
  ('fam-conceived-trip', 'en', 2, 'text', 'Two people, two "separate" trips, one very specific nine-months-later.', null),
  ('fam-conceived-trip', 'en', 4, 'text', 'The official story is that they were not even in the same country.', null),
  ('fam-conceived-trip', 'en', 5, 'text', 'I have seen a photo that puts them on the same beach.', null),
  ('fam-conceived-trip', 'en', 7, 'text', 'My birthday minus nine months lands exactly on that trip.', null),
  ('fam-conceived-trip', 'en', 9, 'text', 'They still say those holidays were apart. I am the proof they were not.', null),
  ('fam-conceived-trip', 'fr', 0, 'text', 'Il y a un bout d''histoire familiale où les dates ne collent pas et personne ne veut faire le calcul.', null),
  ('fam-conceived-trip', 'fr', 2, 'text', 'Deux personnes, deux voyages « séparés », un neuf-mois-plus-tard très précis.', null),
  ('fam-conceived-trip', 'fr', 4, 'text', 'La version officielle, c''est qu''ils n''étaient même pas dans le même pays.', null),
  ('fam-conceived-trip', 'fr', 5, 'text', 'J''ai vu une photo qui les met sur la même plage.', null),
  ('fam-conceived-trip', 'fr', 7, 'text', 'Mon anniversaire moins neuf mois tombe pile sur ce voyage.', null),
  ('fam-conceived-trip', 'fr', 9, 'text', 'Ils disent encore que ces vacances étaient séparées. Je suis la preuve que non.', null),

  ('fam-recipe-grave', '*',  1, 'emoji', '🍲⚰️', null),
  ('fam-recipe-grave', '*',  3, 'emoji', '📝🔥', null),
  ('fam-recipe-grave', '*',  6, 'image', null, 'lucide:lock'),
  ('fam-recipe-grave', '*',  8, 'emoji', '👵🍽️🚫', null),
  ('fam-recipe-grave', 'en', 0, 'text', 'There is something I could pass on to the family and have decided not to.', null),
  ('fam-recipe-grave', 'en', 2, 'text', 'People ask me for it at every gathering. I smile and change the subject.', null),
  ('fam-recipe-grave', 'en', 4, 'text', 'They think I have written it down somewhere safe.', null),
  ('fam-recipe-grave', 'en', 5, 'text', 'It is not written down anywhere. On purpose.', null),
  ('fam-recipe-grave', 'en', 7, 'text', 'When I go, one specific taste goes with me.', null),
  ('fam-recipe-grave', 'en', 9, 'text', 'The recipe ends with me, and I have made my peace with that.', null),
  ('fam-recipe-grave', 'fr', 0, 'text', 'Il y a une chose que je pourrais transmettre à la famille et que j''ai décidé de garder.', null),
  ('fam-recipe-grave', 'fr', 2, 'text', 'On me la demande à chaque réunion. Je souris et je change de sujet.', null),
  ('fam-recipe-grave', 'fr', 4, 'text', 'Ils croient que je l''ai notée quelque part en lieu sûr.', null),
  ('fam-recipe-grave', 'fr', 5, 'text', 'Elle n''est notée nulle part. Exprès.', null),
  ('fam-recipe-grave', 'fr', 7, 'text', 'Quand je partirai, un goût précis partira avec moi.', null),
  ('fam-recipe-grave', 'fr', 9, 'text', 'La recette s''arrête à moi, et je l''ai accepté.', null),

  ('fam-intercept-mail', '*',  1, 'emoji', '✉️🤫', null),
  ('fam-intercept-mail', '*',  3, 'emoji', '🕵️💰', null),
  ('fam-intercept-mail', '*',  6, 'image', null, 'lucide:mailbox'),
  ('fam-intercept-mail', '*',  8, 'emoji', '📮🔴💸🙈', null),
  ('fam-intercept-mail', 'en', 0, 'text', 'For about a year I got to the letterbox before anyone else, every single day.', null),
  ('fam-intercept-mail', 'en', 2, 'text', 'There was one envelope I could not let land on the kitchen table.', null),
  ('fam-intercept-mail', 'en', 4, 'text', 'It looked like I was snooping. Some of the family still think that.', null),
  ('fam-intercept-mail', 'en', 5, 'text', 'I was not reading their post for fun. I was filtering it.', null),
  ('fam-intercept-mail', 'en', 7, 'text', 'A red-stamped letter kept arriving, and I kept making it disappear.', null),
  ('fam-intercept-mail', 'en', 9, 'text', 'I hid a year of debt notices so someone would not have to see them.', null),
  ('fam-intercept-mail', 'fr', 0, 'text', 'Pendant environ un an, j''arrivais à la boîte aux lettres avant tout le monde, chaque jour.', null),
  ('fam-intercept-mail', 'fr', 2, 'text', 'Il y avait une enveloppe que je ne pouvais pas laisser atterrir sur la table de la cuisine.', null),
  ('fam-intercept-mail', 'fr', 4, 'text', 'On aurait dit que je fouinais. Une partie de la famille le croit encore.', null),
  ('fam-intercept-mail', 'fr', 5, 'text', 'Je ne lisais pas leur courrier pour le plaisir. Je le filtrais.', null),
  ('fam-intercept-mail', 'fr', 7, 'text', 'Une lettre à cachet rouge revenait sans cesse, et je la faisais disparaître à chaque fois.', null),
  ('fam-intercept-mail', 'fr', 9, 'text', 'J''ai caché un an d''avis de dettes pour que quelqu''un n''ait pas à les voir.', null),

  ('fam-fake-degree', '*',  1, 'emoji', '🎓🫥', null),
  ('fam-fake-degree', '*',  3, 'emoji', '📜❓', null),
  ('fam-fake-degree', '*',  6, 'image', null, 'lucide:graduation-cap'),
  ('fam-fake-degree', '*',  8, 'emoji', '🎓📸➡️📕❌', null),
  ('fam-fake-degree', 'en', 0, 'text', 'There is a certificate on my parents'' wall for something that did not quite happen.', null),
  ('fam-fake-degree', 'en', 2, 'text', 'I went to the ceremony. That part was real.', null),
  ('fam-fake-degree', 'en', 4, 'text', 'Everyone puts that last year down to me being "bad at keeping in touch".', null),
  ('fam-fake-degree', 'en', 5, 'text', 'I walked across the stage owing them one thing I never handed in.', null),
  ('fam-fake-degree', 'en', 7, 'text', 'The gown was rented, the photos are framed, the final credits are missing.', null),
  ('fam-fake-degree', 'en', 9, 'text', 'My family thinks I graduated. Technically, I did not.', null),
  ('fam-fake-degree', 'fr', 0, 'text', 'Il y a un diplôme au mur chez mes parents pour une chose qui ne s''est pas tout à fait faite.', null),
  ('fam-fake-degree', 'fr', 2, 'text', 'Je suis allé à la cérémonie. Cette partie était vraie.', null),
  ('fam-fake-degree', 'fr', 4, 'text', 'Tout le monde met cette dernière année sur le compte de mon « je donne peu de nouvelles ».', null),
  ('fam-fake-degree', 'fr', 5, 'text', 'J''ai traversé la scène en leur devant une chose que je n''ai jamais rendue.', null),
  ('fam-fake-degree', 'fr', 7, 'text', 'La toge était louée, les photos sont encadrées, les derniers crédits manquent.', null),
  ('fam-fake-degree', 'fr', 9, 'text', 'Ma famille croit que j''ai eu mon diplôme. Techniquement, non.', null),

  ('fam-funeral-cousin', '*',  1, 'emoji', '⚰️🤝', null),
  ('fam-funeral-cousin', '*',  3, 'emoji', '👨‍👨‍👦❔', null),
  ('fam-funeral-cousin', '*',  6, 'image', null, 'lucide:users'),
  ('fam-funeral-cousin', '*',  8, 'emoji', '🖤⚰️➡️👨‍👩‍👧‍👦', null),
  ('fam-funeral-cousin', 'en', 0, 'text', 'I have a relative I can date the start of our relationship to the exact day.', null),
  ('fam-funeral-cousin', 'en', 2, 'text', 'We are close now. For thirty-odd years we were strangers.', null),
  ('fam-funeral-cousin', 'en', 4, 'text', 'I assumed there had been a falling-out nobody told me about.', null),
  ('fam-funeral-cousin', 'en', 5, 'text', 'No falling-out. Just two halves of a family that were never in the same room.', null),
  ('fam-funeral-cousin', 'en', 7, 'text', 'We introduced ourselves next to a coffin and swapped numbers at the wake.', null),
  ('fam-funeral-cousin', 'en', 9, 'text', 'I met my own cousin for the first time in my thirties, at a funeral.', null),
  ('fam-funeral-cousin', 'fr', 0, 'text', 'J''ai un proche dont je peux dater le début de notre relation au jour près.', null),
  ('fam-funeral-cousin', 'fr', 2, 'text', 'On est proches aujourd''hui. Pendant une trentaine d''années, on était des inconnus.', null),
  ('fam-funeral-cousin', 'fr', 4, 'text', 'Je supposais qu''il y avait eu une brouille qu''on ne m''avait pas racontée.', null),
  ('fam-funeral-cousin', 'fr', 5, 'text', 'Aucune brouille. Juste deux moitiés d''une famille jamais réunies dans la même pièce.', null),
  ('fam-funeral-cousin', 'fr', 7, 'text', 'On s''est présentés à côté d''un cercueil et on a échangé nos numéros à la veillée.', null),
  ('fam-funeral-cousin', 'fr', 9, 'text', 'J''ai rencontré mon propre cousin pour la première fois dans la trentaine, à un enterrement.', null)
) as h(handle, locale, position, kind, text, image_ref)
  on h.handle = s.handle and (h.locale = s.locale or h.locale = '*')
on conflict (secret_bank_id, position) do nothing;

-- family pack C (seed 2) ---------------------------------------------------
with s as (
  select b.id, m.handle, m.locale
  from public.secret_bank b
  join (values
    ('fam-typo-name',            'family', 'en', 'My middle name is a typo on my birth certificate that stuck.'),
    ('fam-typo-name',            'family', 'fr', 'Mon deuxième prénom est une faute sur mon acte de naissance qui est restée.'),
    ('fam-ring-given-away',      'family', 'en', 'I gave away a family ring and said it was stolen.'),
    ('fam-ring-given-away',      'family', 'fr', 'J''ai donné une bague de famille et dit qu''on me l''avait volée.'),
    ('fam-adoption-papers',      'family', 'en', 'I found my adoption papers before anyone planned to tell me.'),
    ('fam-adoption-papers',      'family', 'fr', 'J''ai trouvé mes papiers d''adoption avant qu''on prévoie de me le dire.'),
    ('fam-parent-engaged',       'family', 'en', 'My parents met while one of them was engaged to someone else.'),
    ('fam-parent-engaged',       'family', 'fr', 'Mes parents se sont rencontrés alors que l''un était fiancé à quelqu''un d''autre.'),
    ('fam-secret-rent',          'family', 'en', 'I have quietly paid a relative''s rent for two years.'),
    ('fam-secret-rent',          'family', 'fr', 'Je paie discrètement le loyer d''un proche depuis deux ans.'),
    ('fam-parents-ex-friend',    'family', 'en', 'A "family friend" at every holiday is actually my parent''s ex.'),
    ('fam-parents-ex-friend',    'family', 'fr', 'Un « ami de la famille » présent à chaque fête est en fait l''ex d''un de mes parents.'),
    ('fam-lost-deed',            'family', 'en', 'I lost the deed to a family plot and never admitted it.'),
    ('fam-lost-deed',            'family', 'fr', 'J''ai perdu l''acte de propriété d''un terrain familial et je ne l''ai jamais avoué.'),
    ('fam-grandad-first-family', 'family', 'en', 'My grandfather had a whole first family we only learned about later.'),
    ('fam-grandad-first-family', 'family', 'fr', 'Mon grand-père avait toute une première famille dont on n''a appris l''existence que plus tard.'),
    ('fam-forged-signature',     'family', 'en', 'I forged a parent''s signature on school reports for three years.'),
    ('fam-forged-signature',     'family', 'fr', 'J''ai imité la signature d''un parent sur mes bulletins pendant trois ans.')
  ) as m(handle, category, locale, secret_text)
    on m.category = b.category and m.locale = b.locale and m.secret_text = b.text
)
insert into public.secret_bank_hints (secret_bank_id, position, kind, text, image_ref)
select s.id, h.position, h.kind, h.text, h.image_ref
from s
join (values
  ('fam-typo-name', '*',  1, 'emoji', '📄✍️😅'::text, null::text),
  ('fam-typo-name', '*',  3, 'emoji', '🔤❌', null),
  ('fam-typo-name', '*',  6, 'image', null, 'lucide:file-text'),
  ('fam-typo-name', '*',  8, 'emoji', '🖊️🤷➡️🆔', null),
  ('fam-typo-name', 'en', 0, 'text', 'My full legal name contains a small mistake that everyone just went along with.', null),
  ('fam-typo-name', 'en', 2, 'text', 'My middle name is not quite the one my parents chose.', null),
  ('fam-typo-name', 'en', 4, 'text', 'People think my parents were being creative.', null),
  ('fam-typo-name', 'en', 5, 'text', 'They were not. Someone at a desk misheard or misspelled it.', null),
  ('fam-typo-name', 'en', 7, 'text', 'It was easier to keep it than to correct a government document.', null),
  ('fam-typo-name', 'en', 9, 'text', 'My middle name is a typo nobody ever bothered to undo.', null),
  ('fam-typo-name', 'fr', 0, 'text', 'Mon nom légal complet contient une petite erreur que tout le monde a simplement acceptée.', null),
  ('fam-typo-name', 'fr', 2, 'text', 'Mon deuxième prénom n''est pas tout à fait celui que mes parents avaient choisi.', null),
  ('fam-typo-name', 'fr', 4, 'text', 'Les gens croient que mes parents ont fait un choix original.', null),
  ('fam-typo-name', 'fr', 5, 'text', 'Pas du tout. Quelqu''un à un guichet a mal entendu ou mal orthographié.', null),
  ('fam-typo-name', 'fr', 7, 'text', 'C''était plus simple de le garder que de corriger un document officiel.', null),
  ('fam-typo-name', 'fr', 9, 'text', 'Mon deuxième prénom est une faute que personne n''a jamais pris la peine de corriger.', null),

  ('fam-ring-given-away', '*',  1, 'emoji', '💍🚨', null),
  ('fam-ring-given-away', '*',  3, 'emoji', '🕶️💰', null),
  ('fam-ring-given-away', '*',  6, 'image', null, 'lucide:gift'),
  ('fam-ring-given-away', '*',  8, 'emoji', '💍🤲➡️🧑🤥', null),
  ('fam-ring-given-away', 'en', 0, 'text', 'There is a piece of family jewellery I am officially a victim about.', null),
  ('fam-ring-given-away', 'en', 2, 'text', 'The story is that it was taken. I tell that story well.', null),
  ('fam-ring-given-away', 'en', 4, 'text', 'Everyone assumed a break-in, or a dodgy cleaner.', null),
  ('fam-ring-given-away', 'en', 5, 'text', 'Nobody broke in. It left in my hand, on purpose.', null),
  ('fam-ring-given-away', 'en', 7, 'text', 'I decided someone outside the family should have it, and I could not say that out loud.', null),
  ('fam-ring-given-away', 'en', 9, 'text', 'I gave the family ring away and reported it stolen so I would never have to explain.', null),
  ('fam-ring-given-away', 'fr', 0, 'text', 'Il y a un bijou de famille dont je suis officiellement la victime.', null),
  ('fam-ring-given-away', 'fr', 2, 'text', 'L''histoire, c''est qu''on l''a volé. Je raconte bien cette histoire.', null),
  ('fam-ring-given-away', 'fr', 4, 'text', 'Tout le monde a imaginé un cambriolage, ou une femme de ménage douteuse.', null),
  ('fam-ring-given-away', 'fr', 5, 'text', 'Personne n''est entré par effraction. Il est parti dans ma main, exprès.', null),
  ('fam-ring-given-away', 'fr', 7, 'text', 'J''ai décidé que quelqu''un hors de la famille devait l''avoir, et je ne pouvais pas le dire tout haut.', null),
  ('fam-ring-given-away', 'fr', 9, 'text', 'J''ai donné la bague de famille et déclaré un vol pour ne jamais avoir à m''expliquer.', null),

  ('fam-adoption-papers', '*',  1, 'emoji', '🗂️😶', null),
  ('fam-adoption-papers', '*',  3, 'emoji', '👶📑', null),
  ('fam-adoption-papers', '*',  6, 'image', null, 'lucide:folder-open'),
  ('fam-adoption-papers', '*',  8, 'emoji', '📂🔍➡️😮🤐', null),
  ('fam-adoption-papers', 'en', 0, 'text', 'I learned something central about myself from a folder, not a conversation.', null),
  ('fam-adoption-papers', 'en', 2, 'text', 'There was going to be a talk "when I was older". I skipped ahead.', null),
  ('fam-adoption-papers', 'en', 4, 'text', 'People assume a cousin blurted it out at a party.', null),
  ('fam-adoption-papers', 'en', 5, 'text', 'Nobody told me. I was looking for a passport and found more than that.', null),
  ('fam-adoption-papers', 'en', 7, 'text', 'I put the folder back exactly as it was and said nothing for a long time.', null),
  ('fam-adoption-papers', 'en', 9, 'text', 'I found my own adoption papers before my parents ever got to have that conversation.', null),
  ('fam-adoption-papers', 'fr', 0, 'text', 'J''ai appris une chose essentielle sur moi dans un classeur, pas dans une conversation.', null),
  ('fam-adoption-papers', 'fr', 2, 'text', 'Il devait y avoir une discussion « quand je serais plus grand ». J''ai pris de l''avance.', null),
  ('fam-adoption-papers', 'fr', 4, 'text', 'Les gens supposent qu''un cousin l''a lâché à une fête.', null),
  ('fam-adoption-papers', 'fr', 5, 'text', 'Personne ne me l''a dit. Je cherchais un passeport et j''ai trouvé plus que ça.', null),
  ('fam-adoption-papers', 'fr', 7, 'text', 'J''ai remis le classeur exactement comme il était et je n''ai rien dit pendant longtemps.', null),
  ('fam-adoption-papers', 'fr', 9, 'text', 'J''ai trouvé mes papiers d''adoption avant que mes parents aient pu avoir cette conversation.', null),

  ('fam-parent-engaged', '*',  1, 'emoji', '💍👀', null),
  ('fam-parent-engaged', '*',  3, 'emoji', '🤵❓👰❓', null),
  ('fam-parent-engaged', '*',  6, 'image', null, 'lucide:heart-handshake'),
  ('fam-parent-engaged', '*',  8, 'emoji', '💒📅➡️❌❤️', null),
  ('fam-parent-engaged', 'en', 0, 'text', 'The cute version of how my parents met leaves one person out.', null),
  ('fam-parent-engaged', 'en', 2, 'text', 'When they met, a wedding was already being planned. Not theirs.', null),
  ('fam-parent-engaged', 'en', 4, 'text', 'For years the story was just "they met through friends".', null),
  ('fam-parent-engaged', 'en', 5, 'text', 'One of my parents had to give a ring back to make the story work out.', null),
  ('fam-parent-engaged', 'en', 7, 'text', 'There is an ex out there who got very close to a completely different life.', null),
  ('fam-parent-engaged', 'en', 9, 'text', 'My parents got together while one of them was engaged to someone else.', null),
  ('fam-parent-engaged', 'fr', 0, 'text', 'La jolie version de la rencontre de mes parents oublie une personne.', null),
  ('fam-parent-engaged', 'fr', 2, 'text', 'Quand ils se sont rencontrés, un mariage était déjà en préparation. Pas le leur.', null),
  ('fam-parent-engaged', 'fr', 4, 'text', 'Pendant des années, l''histoire était juste « on s''est rencontrés par des amis ».', null),
  ('fam-parent-engaged', 'fr', 5, 'text', 'L''un de mes parents a dû rendre une bague pour que l''histoire tienne.', null),
  ('fam-parent-engaged', 'fr', 7, 'text', 'Il y a un ex quelque part qui a frôlé une vie complètement différente.', null),
  ('fam-parent-engaged', 'fr', 9, 'text', 'Mes parents se sont mis ensemble alors que l''un était fiancé à quelqu''un d''autre.', null),

  ('fam-secret-rent', '*',  1, 'emoji', '🏠💸🤫', null),
  ('fam-secret-rent', '*',  3, 'emoji', '🧾🙈', null),
  ('fam-secret-rent', '*',  6, 'image', null, 'lucide:hand-coins'),
  ('fam-secret-rent', '*',  8, 'emoji', '📆🏠✅🤐', null),
  ('fam-secret-rent', 'en', 0, 'text', 'There is a standing arrangement in my family that only two people know about.', null),
  ('fam-secret-rent', 'en', 2, 'text', 'Once a month I move money for a reason I never put in the group chat.', null),
  ('fam-secret-rent', 'en', 4, 'text', 'The family thinks this relative is "doing fine now".', null),
  ('fam-secret-rent', 'en', 5, 'text', 'They are doing fine because a payment lands before the rent is due.', null),
  ('fam-secret-rent', 'en', 7, 'text', 'Two years of landlords paid on time by someone who is not on the lease.', null),
  ('fam-secret-rent', 'en', 9, 'text', 'I have quietly covered a relative''s rent for two years and they would be mortified if the family knew.', null),
  ('fam-secret-rent', 'fr', 0, 'text', 'Il y a un arrangement permanent dans ma famille que seules deux personnes connaissent.', null),
  ('fam-secret-rent', 'fr', 2, 'text', 'Une fois par mois, je déplace de l''argent pour une raison que je ne mets jamais dans le groupe.', null),
  ('fam-secret-rent', 'fr', 4, 'text', 'La famille croit que ce proche « s''en sort bien maintenant ».', null),
  ('fam-secret-rent', 'fr', 5, 'text', 'Il s''en sort bien parce qu''un virement arrive avant l''échéance du loyer.', null),
  ('fam-secret-rent', 'fr', 7, 'text', 'Deux ans de loyers payés à temps par quelqu''un qui n''est pas sur le bail.', null),
  ('fam-secret-rent', 'fr', 9, 'text', 'Je couvre discrètement le loyer d''un proche depuis deux ans et il serait mortifié si la famille le savait.', null),

  ('fam-parents-ex-friend', '*',  1, 'emoji', '🍗🪑👤', null),
  ('fam-parents-ex-friend', '*',  3, 'emoji', '💔🥂', null),
  ('fam-parents-ex-friend', '*',  6, 'image', null, 'lucide:users-round'),
  ('fam-parents-ex-friend', '*',  8, 'emoji', '👩‍❤️‍👨➡️🤝🎄', null),
  ('fam-parents-ex-friend', 'en', 0, 'text', 'Every holiday there is a guest whose seat at the table has a backstory.', null),
  ('fam-parents-ex-friend', 'en', 2, 'text', 'We call them a family friend. That label is doing a lot of work.', null),
  ('fam-parents-ex-friend', 'en', 4, 'text', 'I used to think they were just an old colleague of my dad''s.', null),
  ('fam-parents-ex-friend', 'en', 5, 'text', 'They knew one of my parents very well before the other one came along.', null),
  ('fam-parents-ex-friend', 'en', 7, 'text', 'There are photos from decades ago where they are holding hands with someone I call Mum or Dad.', null),
  ('fam-parents-ex-friend', 'en', 9, 'text', 'The "family friend" who never misses a holiday is my parent''s ex.', null),
  ('fam-parents-ex-friend', 'fr', 0, 'text', 'À chaque fête, il y a un invité dont la place à table a toute une histoire.', null),
  ('fam-parents-ex-friend', 'fr', 2, 'text', 'On l''appelle un ami de la famille. Ce mot en dit long.', null),
  ('fam-parents-ex-friend', 'fr', 4, 'text', 'Je croyais que c''était juste un ancien collègue de mon père.', null),
  ('fam-parents-ex-friend', 'fr', 5, 'text', 'Il a très bien connu l''un de mes parents avant que l''autre n''arrive.', null),
  ('fam-parents-ex-friend', 'fr', 7, 'text', 'Il y a des photos d''il y a des décennies où il tient la main de celui que j''appelle papa ou maman.', null),
  ('fam-parents-ex-friend', 'fr', 9, 'text', 'L''« ami de la famille » qui ne rate jamais une fête est l''ex d''un de mes parents.', null),

  ('fam-lost-deed', '*',  1, 'emoji', '📜🕳️', null),
  ('fam-lost-deed', '*',  3, 'emoji', '🏞️❓', null),
  ('fam-lost-deed', '*',  6, 'image', null, 'lucide:scroll'),
  ('fam-lost-deed', '*',  8, 'emoji', '🗺️🧾❌😰', null),
  ('fam-lost-deed', 'en', 0, 'text', 'There is a document I was trusted with that I can no longer produce.', null),
  ('fam-lost-deed', 'en', 2, 'text', 'It proves the family owns a particular piece of ground.', null),
  ('fam-lost-deed', 'en', 4, 'text', 'When it comes up, I imply it is "with the solicitor".', null),
  ('fam-lost-deed', 'en', 5, 'text', 'It is not with the solicitor. It is not anywhere I have managed to find.', null),
  ('fam-lost-deed', 'en', 7, 'text', 'Every few years someone asks about that land and I change the subject fast.', null),
  ('fam-lost-deed', 'en', 9, 'text', 'I lost the deed to a family plot years ago and have never once admitted it.', null),
  ('fam-lost-deed', 'fr', 0, 'text', 'Il y a un document qu''on m''a confié et que je ne peux plus produire.', null),
  ('fam-lost-deed', 'fr', 2, 'text', 'Il prouve que la famille possède un terrain précis.', null),
  ('fam-lost-deed', 'fr', 4, 'text', 'Quand le sujet arrive, je laisse entendre qu''il est « chez le notaire ».', null),
  ('fam-lost-deed', 'fr', 5, 'text', 'Il n''est pas chez le notaire. Il n''est nulle part où j''ai réussi à chercher.', null),
  ('fam-lost-deed', 'fr', 7, 'text', 'Tous les quelques ans, quelqu''un pose une question sur ce terrain et je change vite de sujet.', null),
  ('fam-lost-deed', 'fr', 9, 'text', 'J''ai perdu l''acte de propriété d''un terrain familial il y a des années et je ne l''ai jamais avoué.', null),

  ('fam-grandad-first-family', '*',  1, 'emoji', '👴📖❓', null),
  ('fam-grandad-first-family', '*',  3, 'emoji', '👨‍👩‍👧‍👦🔁', null),
  ('fam-grandad-first-family', '*',  6, 'image', null, 'lucide:users'),
  ('fam-grandad-first-family', '*',  8, 'emoji', '👴1️⃣➡️2️⃣👨‍👩‍👧‍👦', null),
  ('fam-grandad-first-family', 'en', 0, 'text', 'My grandfather''s life had a whole chapter we did not get to read until recently.', null),
  ('fam-grandad-first-family', 'en', 2, 'text', 'There are people who share my surname that we had never heard of.', null),
  ('fam-grandad-first-family', 'en', 4, 'text', 'At first we thought it was one secret child.', null),
  ('fam-grandad-first-family', 'en', 5, 'text', 'It was not one child. It was a wife and several of them.', null),
  ('fam-grandad-first-family', 'en', 7, 'text', 'Somewhere there is a set of aunts and uncles my parents met as adults.', null),
  ('fam-grandad-first-family', 'en', 9, 'text', 'My grandfather had an entire first family nobody told us about.', null),
  ('fam-grandad-first-family', 'fr', 0, 'text', 'La vie de mon grand-père avait tout un chapitre qu''on n''a pu lire que récemment.', null),
  ('fam-grandad-first-family', 'fr', 2, 'text', 'Il y a des gens qui portent mon nom de famille et dont on n''avait jamais entendu parler.', null),
  ('fam-grandad-first-family', 'fr', 4, 'text', 'Au début, on croyait à un seul enfant caché.', null),
  ('fam-grandad-first-family', 'fr', 5, 'text', 'Ce n''était pas un enfant. C''était une épouse et plusieurs d''entre eux.', null),
  ('fam-grandad-first-family', 'fr', 7, 'text', 'Quelque part, il y a des oncles et des tantes que mes parents ont rencontrés adultes.', null),
  ('fam-grandad-first-family', 'fr', 9, 'text', 'Mon grand-père avait toute une première famille dont personne ne nous avait parlé.', null),

  ('fam-forged-signature', '*',  1, 'emoji', '✍️🎒', null),
  ('fam-forged-signature', '*',  3, 'emoji', '📄🖊️😬', null),
  ('fam-forged-signature', '*',  6, 'image', null, 'lucide:pen-line'),
  ('fam-forged-signature', '*',  8, 'emoji', '👦🖋️➡️👨‍👩🤫', null),
  ('fam-forged-signature', 'en', 0, 'text', 'For three school years, a parent "saw" every report without ever seeing one.', null),
  ('fam-forged-signature', 'en', 2, 'text', 'There is a signature in my school file that a handwriting expert would enjoy.', null),
  ('fam-forged-signature', 'en', 4, 'text', 'It was not because I was failing.', null),
  ('fam-forged-signature', 'en', 5, 'text', 'It was easier than the conversation that came with handing them over.', null),
  ('fam-forged-signature', 'en', 7, 'text', 'I practised one adult''s signature until it was better than theirs.', null),
  ('fam-forged-signature', 'en', 9, 'text', 'I forged a parent''s signature on my school reports for three years straight.', null),
  ('fam-forged-signature', 'fr', 0, 'text', 'Pendant trois années scolaires, un parent « voyait » chaque bulletin sans jamais en voir un.', null),
  ('fam-forged-signature', 'fr', 2, 'text', 'Il y a une signature dans mon dossier scolaire qu''un expert en écriture adorerait.', null),
  ('fam-forged-signature', 'fr', 4, 'text', 'Ce n''était pas parce que j''étais en échec.', null),
  ('fam-forged-signature', 'fr', 5, 'text', 'C''était plus simple que la conversation qui venait avec le fait de les montrer.', null),
  ('fam-forged-signature', 'fr', 7, 'text', 'J''ai répété la signature d''un adulte jusqu''à ce qu''elle soit meilleure que la sienne.', null),
  ('fam-forged-signature', 'fr', 9, 'text', 'J''ai imité la signature d''un parent sur mes bulletins pendant trois ans d''affilée.', null)
) as h(handle, locale, position, kind, text, image_ref)
  on h.handle = s.handle and (h.locale = s.locale or h.locale = '*')
on conflict (secret_bank_id, position) do nothing;

-- ---------------------------------------------------------------------------
-- RENDERER FOLLOW-UP (not in this migration):
-- player-dashboard.tsx / host-control-room.tsx / public-display.tsx currently
-- render an image hint by hitting /api/assets/hints/[hintId] (storage only).
-- They need a branch: when hints.image_ref is set and has no asset_path,
-- render the icon named after the ':' with lucide-react instead. Emoji and
-- text hints already render as-is.
-- ---------------------------------------------------------------------------
