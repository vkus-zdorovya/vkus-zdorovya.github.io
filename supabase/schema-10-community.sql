-- =====================================================================
-- ВкусЗдоровья — часть 10: предпочтения, цели, рецепты участников, достижения,
-- челленджи, лайки, уведомления, активность, фото в дневнике, жалобы и блокировки
-- Выполните ПОСЛЕ файлов 1–9. Можно запускать повторно. Пароль админки не трогает.
-- =====================================================================

-- =====================================================================
-- 1. Предпочтения и цель (аллергии, тип питания, желаемый вес) — видит только владелец
-- =====================================================================
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_prefs_check;
alter table public.profiles add constraint profiles_prefs_check
  check (jsonb_typeof(prefs) = 'object' and octet_length(prefs::text) <= 4000) not valid;
grant update (prefs) on public.profiles to authenticated;

-- =====================================================================
-- 2. Уведомления (колокольчик)
-- =====================================================================
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  body       text not null check (char_length(body) <= 300),
  link       text check (char_length(link) <= 200),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "Уведомления: свои" on public.notifications;
create policy "Уведомления: свои" on public.notifications
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Уведомления: удалять свои" on public.notifications;
create policy "Уведомления: удалять свои" on public.notifications
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;

-- создаёт уведомление; одинаковые за сутки не повторяются (например, лайк — снял — лайк)
create or replace function public.notify(target uuid, kind_ text, body_ text, link_ text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if target is null then return; end if;
  if exists (select 1 from public.notifications n
              where n.user_id = target and n.kind = kind_ and n.body = left(body_, 300)
                and n.created_at > now() - interval '1 day') then
    return;
  end if;
  insert into public.notifications (user_id, kind, body, link) values (target, kind_, left(body_, 300), link_);
  -- храним не больше 100 последних
  delete from public.notifications n where n.user_id = target and n.id not in
    (select id from public.notifications where user_id = target order by created_at desc limit 100);
end;
$$;
revoke execute on function public.notify(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.notif_unread_count()
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.notif_mark_read()
returns void
language sql
security definer set search_path = ''
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- =====================================================================
-- 3. Лайки на форуме
-- =====================================================================
create table if not exists public.forum_likes (
  post_id    bigint not null references public.forum_posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.forum_likes enable row level security;
drop policy if exists "Лайки: видят все" on public.forum_likes;
create policy "Лайки: видят все" on public.forum_likes for select using (true);
drop policy if exists "Лайки: ставить от себя" on public.forum_likes;
create policy "Лайки: ставить от себя" on public.forum_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Лайки: снимать свои" on public.forum_likes;
create policy "Лайки: снимать свои" on public.forum_likes
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.forum_likes from anon;
revoke update on public.forum_likes from authenticated;
grant select on public.forum_likes to anon;
grant select, insert, delete on public.forum_likes to authenticated;

create or replace function public.forum_like_notify()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  p record;
begin
  select author_id, title into p from public.forum_posts where id = new.post_id;
  if p.author_id is not null and p.author_id <> new.user_id then
    perform public.notify(p.author_id, 'like',
      public.chat_name(new.user_id) || ' оценил(а) вашу тему «' || left(p.title, 80) || '»', 'forum.html#post-' || new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists forum_likes_notify on public.forum_likes;
create trigger forum_likes_notify after insert on public.forum_likes
  for each row execute procedure public.forum_like_notify();

create or replace function public.forum_reply_notify()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  p record;
begin
  select author_id, title into p from public.forum_posts where id = new.post_id;
  if p.author_id is not null and p.author_id <> new.author_id then
    perform public.notify(p.author_id, 'reply',
      coalesce(new.author_name, 'Участник') || ' ответил(а) в теме «' || left(p.title, 80) || '»', 'forum.html#post-' || new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists forum_replies_notify on public.forum_replies;
create trigger forum_replies_notify after insert on public.forum_replies
  for each row execute procedure public.forum_reply_notify();

-- одобрение или отклонение аватарки и баннера администратором
create or replace function public.profile_media_notify()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() = new.id then return new; end if;
  if old.avatar_pending is not null and new.avatar_pending is null then
    perform public.notify(new.id, 'media', case when new.avatar_url = old.avatar_pending
      then '✅ Ваше фото профиля одобрено' else 'Фото профиля не прошло проверку. Попробуйте другое' end, 'account.html');
  end if;
  if old.banner_pending is not null and new.banner_pending is null then
    perform public.notify(new.id, 'media', case when new.banner_url = old.banner_pending
      then '✅ Ваш баннер одобрен' else 'Баннер не прошёл проверку. Попробуйте другой' end, 'account.html');
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_media_notify on public.profiles;
create trigger profiles_media_notify after update on public.profiles
  for each row execute procedure public.profile_media_notify();

create or replace function public.product_request_notify()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    perform public.notify(new.user_id, 'product', case when new.status = 'approved'
      then '✅ Товар «' || left(new.name, 80) || '» добавлен в базу сканера. Спасибо!'
      else 'Товар «' || left(new.name, 80) || '» не прошёл проверку' end, 'scanner.html?code=' || new.barcode);
  end if;
  return new;
end;
$$;
drop trigger if exists product_requests_notify on public.product_requests;
create trigger product_requests_notify after update on public.product_requests
  for each row execute procedure public.product_request_notify();

-- =====================================================================
-- 4. Рецепты участников, избранное и оценки
-- =====================================================================
create table if not exists public.user_recipes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 3 and 100),
  meal        text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  minutes     integer not null check (minutes between 1 and 600),
  portion     numeric not null check (portion between 10 and 3000),
  kcal        numeric not null check (kcal between 0 and 5000),
  protein     numeric not null check (protein between 0 and 500),
  fat         numeric not null check (fat between 0 and 500),
  carbs       numeric not null check (carbs between 0 and 500),
  ingredients text not null check (char_length(ingredients) between 5 and 2000),
  steps       text not null check (char_length(steps) between 10 and 4000),
  tags        text[] not null default '{}' check (tags <@ array['veg', 'vegan', 'gf', 'lf']),
  photo_path  text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);
create index if not exists user_recipes_status_idx on public.user_recipes (status, created_at desc);

alter table public.user_recipes enable row level security;
drop policy if exists "Рецепты: одобренные всем, свои автору" on public.user_recipes;
create policy "Рецепты: одобренные всем, свои автору" on public.user_recipes
  for select using (status = 'approved' or auth.uid() = user_id or public.is_admin());
drop policy if exists "Рецепты: предлагать" on public.user_recipes;
create policy "Рецепты: предлагать" on public.user_recipes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Рецепты: удалять свои и админу" on public.user_recipes;
create policy "Рецепты: удалять свои и админу" on public.user_recipes
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());
revoke all on public.user_recipes from anon;
revoke update on public.user_recipes from authenticated;
grant select on public.user_recipes to anon;
grant select, insert, delete on public.user_recipes to authenticated;

create or replace function public.user_recipe_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if new.user_id is null then raise exception 'Сначала войдите в аккаунт'; end if;
  -- рецепт администратора публикуется сразу
  new.status := case when public.is_admin() then 'approved' else 'pending' end;

  select muted_until into until from public.profiles where id = new.user_id;
  if until is not null and until > now() then
    raise exception 'Вы не можете добавлять рецепты до % (МСК)',
      to_char(until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
  end if;
  if public.find_banned_word(concat_ws(' ', new.title, new.ingredients, new.steps)) is not null then
    raise exception 'Текст содержит недопустимые слова. Исправьте его и попробуйте снова';
  end if;
  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> new.user_id::text then
    raise exception 'Неверный путь к фото';
  end if;
  if (select count(*) from public.user_recipes
       where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Не больше 5 рецептов в сутки. Попробуйте завтра';
  end if;
  return new;
end;
$$;
drop trigger if exists user_recipes_check on public.user_recipes;
create trigger user_recipes_check before insert on public.user_recipes
  for each row execute procedure public.user_recipe_check();

drop function if exists public.admin_recipe_requests();
create function public.admin_recipe_requests()
returns table (
  id bigint, title text, meal text, minutes integer, portion numeric, kcal numeric, protein numeric, fat numeric, carbs numeric,
  ingredients text, steps text, tags text[], photo_path text, created_at timestamptz, author_name text, author_email text
)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select r.id, r.title, r.meal, r.minutes, r.portion, r.kcal, r.protein, r.fat, r.carbs,
           r.ingredients, r.steps, r.tags, r.photo_path, r.created_at, public.chat_name(r.user_id), u.email::text
      from public.user_recipes r left join auth.users u on u.id = r.user_id
     where r.status = 'pending' order by r.created_at;
end;
$$;

create or replace function public.admin_review_recipe(recipe_id bigint, approve boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  r public.user_recipes;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.user_recipes set status = case when approve then 'approved' else 'rejected' end
   where id = recipe_id and status = 'pending' returning * into r;
  if not found then raise exception 'Рецепт не найден или уже проверен'; end if;
  perform public.notify(r.user_id, 'recipe', case when approve
    then '✅ Ваш рецепт «' || left(r.title, 80) || '» опубликован'
    else 'Рецепт «' || left(r.title, 80) || '» не прошёл проверку' end, 'recipes.html#u' || r.id);
end;
$$;

create table if not exists public.recipe_favorites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_key text not null check (recipe_key ~ '^[a-z0-9_-]{1,60}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_key)
);
alter table public.recipe_favorites enable row level security;
drop policy if exists "Избранное: только своё" on public.recipe_favorites;
create policy "Избранное: только своё" on public.recipe_favorites
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.recipe_favorites from anon;

create table if not exists public.recipe_ratings (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_key text not null check (recipe_key ~ '^[a-z0-9_-]{1,60}$'),
  stars      smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_key)
);
alter table public.recipe_ratings enable row level security;
drop policy if exists "Оценки: только свои" on public.recipe_ratings;
create policy "Оценки: только свои" on public.recipe_ratings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.recipe_ratings from anon;

-- средняя оценка каждого рецепта (без имён тех, кто оценивал)
create or replace function public.recipe_stats()
returns table (recipe_key text, rating numeric, votes integer)
language sql
stable
security definer set search_path = ''
as $$
  select r.recipe_key, round(avg(r.stars), 1), count(*)::int from public.recipe_ratings r group by r.recipe_key;
$$;

-- =====================================================================
-- 5. Активность и фото еды в дневнике
-- =====================================================================
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  name       text not null check (char_length(name) between 1 and 100),
  minutes    numeric not null check (minutes between 1 and 1440),
  kcal       numeric not null check (kcal between 0 and 10000),
  created_at timestamptz not null default now()
);
create index if not exists activity_log_user_date_idx on public.activity_log (user_id, date);
alter table public.activity_log enable row level security;
drop policy if exists "Активность: только своя" on public.activity_log;
create policy "Активность: только своя" on public.activity_log
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.activity_log from anon;

alter table public.food_diary add column if not exists photo_path text;

-- закрытое хранилище фото еды: видит и меняет только владелец
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diary', 'diary', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Дневник: свои фото читать" on storage.objects;
create policy "Дневник: свои фото читать" on storage.objects
  for select to authenticated using (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Дневник: свои фото загружать" on storage.objects;
create policy "Дневник: свои фото загружать" on storage.objects
  for insert to authenticated with check (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Дневник: свои фото удалять" on storage.objects;
create policy "Дневник: свои фото удалять" on storage.objects
  for delete to authenticated using (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- 6. Челленджи
-- =====================================================================
create table if not exists public.challenges (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 500),
  emoji       text not null default '🎯' check (char_length(emoji) <= 8),
  days        integer not null check (days between 1 and 90),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.challenges enable row level security;
drop policy if exists "Челленджи: видят все" on public.challenges;
create policy "Челленджи: видят все" on public.challenges for select using (true);
drop policy if exists "Челленджи: создаёт админ" on public.challenges;
create policy "Челленджи: создаёт админ" on public.challenges
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Челленджи: удаляет админ" on public.challenges;
create policy "Челленджи: удаляет админ" on public.challenges
  for delete to authenticated using (public.is_admin());
revoke all on public.challenges from anon;
revoke update on public.challenges from authenticated;
grant select on public.challenges to anon;
grant select, insert, delete on public.challenges to authenticated;

create table if not exists public.challenge_members (
  challenge_id bigint not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create table if not exists public.challenge_checkins (
  challenge_id bigint not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  primary key (challenge_id, user_id, day)
);
alter table public.challenge_members enable row level security;
alter table public.challenge_checkins enable row level security;
-- читают и меняют только функции ниже
revoke all on public.challenge_members, public.challenge_checkins from anon, authenticated;

create or replace function public.msk_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Moscow')::date; $$;

drop function if exists public.challenge_list();
create function public.challenge_list()
returns table (id bigint, title text, description text, emoji text, days integer, members integer,
               joined boolean, done integer, checked_today boolean)
language sql
stable
security definer set search_path = ''
as $$
  select c.id, c.title, c.description, c.emoji, c.days,
         (select count(*) from public.challenge_members m where m.challenge_id = c.id)::int,
         exists (select 1 from public.challenge_members m where m.challenge_id = c.id and m.user_id = auth.uid()),
         (select count(*) from public.challenge_checkins k where k.challenge_id = c.id and k.user_id = auth.uid())::int,
         exists (select 1 from public.challenge_checkins k
                  where k.challenge_id = c.id and k.user_id = auth.uid() and k.day = public.msk_today())
    from public.challenges c order by c.created_at;
$$;

drop function if exists public.challenge_board(bigint);
create function public.challenge_board(cid bigint)
returns table (user_id uuid, name text, avatar_url text, done integer, finished boolean)
language sql
stable
security definer set search_path = ''
as $$
  select m.user_id, public.chat_name(m.user_id), p.avatar_url, x.n, x.n >= c.days
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    left join public.profiles p on p.id = m.user_id
    cross join lateral (select count(*)::int as n from public.challenge_checkins k
                         where k.challenge_id = m.challenge_id and k.user_id = m.user_id) x
   where m.challenge_id = cid
   order by x.n desc, m.joined_at
   limit 20;
$$;

create or replace function public.challenge_join(cid bigint)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if not exists (select 1 from public.challenges where id = cid) then raise exception 'Челлендж не найден'; end if;
  insert into public.challenge_members (challenge_id, user_id) values (cid, auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.challenge_leave(cid bigint)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.challenge_checkins where challenge_id = cid and user_id = auth.uid();
  delete from public.challenge_members where challenge_id = cid and user_id = auth.uid();
$$;

-- отметка «сегодня выполнил»: одна в день, не больше длины челленджа
create or replace function public.challenge_checkin(cid bigint)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  total integer;
  n integer;
begin
  if not exists (select 1 from public.challenge_members where challenge_id = cid and user_id = auth.uid()) then
    raise exception 'Сначала присоединитесь к челленджу';
  end if;
  select days into total from public.challenges where id = cid;
  select count(*) into n from public.challenge_checkins where challenge_id = cid and user_id = auth.uid();
  if n >= total then raise exception 'Челлендж уже пройден 🎉'; end if;
  insert into public.challenge_checkins (challenge_id, user_id, day) values (cid, auth.uid(), public.msk_today())
    on conflict do nothing;
  if not found then raise exception 'Сегодня вы уже отметились. Возвращайтесь завтра'; end if;
  if n + 1 >= total then
    perform public.notify(auth.uid(), 'challenge', '🏆 Челлендж «' || (select left(title, 80) from public.challenges where id = cid) || '» пройден!', 'challenges.html');
  end if;
  return n + 1;
end;
$$;

insert into public.challenges (title, description, emoji, days)
select * from (values
  ('7 дней без добавленного сахара', 'Без сладких напитков, конфет и выпечки. Фрукты и ягоды можно.', '🍬', 7),
  ('Вода каждый день', 'Выпивайте свою норму воды. Её считает калькулятор на сайте.', '💧', 14),
  ('5 порций овощей и фруктов', 'Не меньше 400 г овощей и фруктов в день, как советует ВОЗ.', '🥦', 10),
  ('Дневник без пропусков', 'Записывайте в дневник питания всё, что съели за день.', '📔', 21)
) v(title, description, emoji, days)
where not exists (select 1 from public.challenges);

-- =====================================================================
-- 7. Достижения: счётчики для значков в профиле (только числа, без содержимого)
-- =====================================================================
create or replace function public.profile_stats(uid uuid)
returns json
language sql
stable
security definer set search_path = ''
as $$
  with d as (select distinct date from public.food_diary where user_id = uid),
       g as (select date, date - (row_number() over (order by date))::int as grp from d),
       s as (select grp, count(*)::int as n, max(date) as last from g group by grp)
  select json_build_object(
    'diary_days',  (select count(*) from d),
    'best_streak', coalesce((select max(n) from s), 0),
    'streak',      coalesce((select n from s where last >= public.msk_today() - 1 order by last desc limit 1), 0),
    'weights',     (select count(*) from public.weight_log where user_id = uid),
    'activities',  (select count(*) from public.activity_log where user_id = uid),
    'posts',       (select count(*) from public.forum_posts where author_id = uid),
    'replies',     (select count(*) from public.forum_replies where author_id = uid),
    'likes',       (select count(*) from public.forum_likes l join public.forum_posts p on p.id = l.post_id
                     where p.author_id = uid and l.user_id <> uid),
    'products',    (select count(*) from public.product_requests where user_id = uid and status = 'approved'),
    'recipes',     (select count(*) from public.user_recipes where user_id = uid and status = 'approved'),
    'checkins',    (select count(*) from public.challenge_checkins where user_id = uid),
    'challenges',  (select count(*) from public.challenges c
                     where (select count(*) from public.challenge_checkins k
                             where k.challenge_id = c.id and k.user_id = uid) >= c.days),
    'days_member', coalesce((select (public.msk_today() - created_at::date) from public.profiles where id = uid), 0)
  );
$$;

-- =====================================================================
-- 8. Блокировка собеседника
-- =====================================================================
create table if not exists public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
drop policy if exists "Блокировки: только свои" on public.user_blocks;
create policy "Блокировки: только свои" on public.user_blocks
  for all to authenticated using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
revoke all on public.user_blocks from anon;
revoke update on public.user_blocks from authenticated;

-- проверки сообщения — как в части 9, плюс блокировка в личном чате
create or replace function public.chat_message_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
  other uuid;
begin
  -- служебные строки и перенос старых сообщений делают функции — их не проверяем
  if current_setting('app.chat_internal', true) = '1' then return new; end if;

  new.sender_id := auth.uid();
  new.created_at := now();
  if new.sender_id is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if new.kind = 'system' then raise exception 'Недопустимый тип сообщения'; end if;

  select muted_until into until from public.profiles where id = new.sender_id;
  if until is not null and until > now() then
    raise exception 'Вы не можете писать сообщения до % (МСК)',
      to_char(until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
  end if;

  if not (select is_group from public.conversations where id = new.conversation_id) then
    select user_id into other from public.conversation_members
     where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
    if exists (select 1 from public.user_blocks where blocker_id = other and blocked_id = new.sender_id) then
      raise exception 'Этот пользователь ограничил сообщения от вас';
    end if;
    if exists (select 1 from public.user_blocks where blocker_id = new.sender_id and blocked_id = other) then
      raise exception 'Вы заблокировали этого пользователя. Разблокируйте его, чтобы написать';
    end if;
  end if;

  if new.kind = 'text' then
    if coalesce(btrim(new.body), '') = '' then raise exception 'Пустое сообщение'; end if;
    new.file_path := null; new.file_name := null; new.file_size := null; new.file_type := null; new.duration := null;
  else
    -- файл должен лежать в папке этой беседы
    if new.file_path is null or split_part(new.file_path, '/', 1) <> new.conversation_id::text then
      raise exception 'Неверный путь к файлу';
    end if;
  end if;

  if public.find_banned_word(concat_ws(' ', new.body, new.file_name)) is not null then
    raise exception 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  end if;

  if (select count(*) from public.chat_messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Слишком много сообщений подряд. Подождите минуту';
  end if;
  return new;
end;
$$;

-- заблокированный не может добавить вас в беседу: такая строка молча пропускается
create or replace function public.chat_member_block_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and new.user_id <> auth.uid()
     and exists (select 1 from public.conversations c where c.id = new.conversation_id and c.is_group)
     and exists (select 1 from public.user_blocks where blocker_id = new.user_id and blocked_id = auth.uid()) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists conversation_members_block on public.conversation_members;
create trigger conversation_members_block before insert on public.conversation_members
  for each row execute procedure public.chat_member_block_check();

-- =====================================================================
-- 9. Жалобы
-- =====================================================================
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('post', 'reply', 'message', 'profile')),
  target_id   text not null,
  target_user uuid references auth.users (id) on delete cascade,
  excerpt     text,
  reason      text check (char_length(reason) <= 300),
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at);
alter table public.reports enable row level security;
-- таблицу читают и меняют только функции ниже
revoke all on public.reports from anon, authenticated;

-- жалоба: текст нарушения база находит сама, поэтому подделать его нельзя
create or replace function public.report_create(kind_ text, target text, reason_ text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  who uuid;
  txt text;
begin
  if me is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if kind_ in ('post', 'reply', 'message') and target !~ '^[0-9]{1,18}$' then raise exception 'Неверная жалоба'; end if;

  if kind_ = 'post' then
    select author_id, title || E'\n' || body into who, txt from public.forum_posts where id = target::bigint;
  elsif kind_ = 'reply' then
    select author_id, body into who, txt from public.forum_replies where id = target::bigint;
  elsif kind_ = 'message' then
    select sender_id, coalesce(body, '') || case when kind <> 'text' then ' [' || kind || ': ' || coalesce(file_name, '') || ']' else '' end
      into who, txt from public.chat_messages
     where id = target::bigint and public.chat_is_member(conversation_id);
  elsif kind_ = 'profile' then
    select id, 'Профиль: ' || name into who, txt from public.profiles where id::text = target;
  else
    raise exception 'Неверная жалоба';
  end if;
  if who is null then raise exception 'Не нашли то, на что вы жалуетесь. Возможно, это уже удалено'; end if;
  if who = me then raise exception 'Нельзя пожаловаться на себя'; end if;
  if exists (select 1 from public.reports where reporter_id = me and kind = kind_ and target_id = target and status = 'open') then
    raise exception 'Вы уже отправили эту жалобу — она ждёт проверки';
  end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Слишком много жалоб подряд. Попробуйте через час';
  end if;
  insert into public.reports (reporter_id, kind, target_id, target_user, excerpt, reason)
  values (me, kind_, target, who, left(txt, 600), nullif(btrim(left(coalesce(reason_, ''), 300)), ''));
end;
$$;

drop function if exists public.admin_reports();
create function public.admin_reports()
returns table (id bigint, kind text, target_id text, excerpt text, reason text, created_at timestamptz,
               reporter_name text, target_user uuid, target_name text, target_email text, same_target integer)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select r.id, r.kind, r.target_id, r.excerpt, r.reason, r.created_at,
           public.chat_name(r.reporter_id), r.target_user, public.chat_name(r.target_user), u.email::text,
           (select count(*) from public.reports x where x.kind = r.kind and x.target_id = r.target_id and x.status = 'open')::int
      from public.reports r left join auth.users u on u.id = r.target_user
     where r.status = 'open' order by r.created_at;
end;
$$;

-- action: 'delete' — удалить то, на что жалуются; 'dismiss' — отклонить жалобу
create or replace function public.admin_resolve_report(report_id bigint, action text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  r public.reports;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if action not in ('delete', 'dismiss') then raise exception 'Неизвестное действие'; end if;
  select * into r from public.reports where id = report_id and status = 'open';
  if not found then raise exception 'Жалоба не найдена или уже рассмотрена'; end if;

  if action = 'delete' then
    if r.kind = 'post' then delete from public.forum_posts where id = r.target_id::bigint;
    elsif r.kind = 'reply' then delete from public.forum_replies where id = r.target_id::bigint;
    elsif r.kind = 'message' then delete from public.chat_messages where id = r.target_id::bigint;
    else raise exception 'Профиль так удалить нельзя — используйте мут или удаление во вкладке «Пользователи»';
    end if;
  end if;

  update public.reports set status = case when action = 'delete' then 'resolved' else 'dismissed' end, resolved_at = now()
   where kind = r.kind and target_id = r.target_id and status = 'open';
  perform public.notify(r.reporter_id, 'report', case when action = 'delete'
    then 'Спасибо за жалобу: нарушение удалено' else 'Ваша жалоба рассмотрена: нарушений не нашли' end, null);
end;
$$;

-- счётчики очередей для вкладок админки
create or replace function public.admin_queue_counts()
returns json
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return json_build_object(
    'products', (select count(*) from public.product_requests where status = 'pending'),
    'recipes',  (select count(*) from public.user_recipes where status = 'pending'),
    'reports',  (select count(*) from public.reports where status = 'open'));
end;
$$;

-- =====================================================================
-- Права на функции
-- =====================================================================
revoke execute on function
  public.notif_unread_count(), public.notif_mark_read(),
  public.admin_recipe_requests(), public.admin_review_recipe(bigint, boolean),
  public.challenge_join(bigint), public.challenge_leave(bigint), public.challenge_checkin(bigint),
  public.report_create(text, text, text), public.admin_reports(), public.admin_resolve_report(bigint, text),
  public.admin_queue_counts()
  from public, anon;
grant execute on function
  public.notif_unread_count(), public.notif_mark_read(),
  public.admin_recipe_requests(), public.admin_review_recipe(bigint, boolean),
  public.challenge_join(bigint), public.challenge_leave(bigint), public.challenge_checkin(bigint),
  public.report_create(text, text, text), public.admin_reports(), public.admin_resolve_report(bigint, text),
  public.admin_queue_counts()
  to authenticated;
-- эти функции отдают только открытые данные — доступны и гостям
grant execute on function public.recipe_stats(), public.challenge_list(), public.challenge_board(bigint),
  public.profile_stats(uuid), public.msk_today() to anon, authenticated;
