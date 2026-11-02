-- =====================================================================
-- ВкусЗдоровья — часть 5: модерация и баннеры профиля
--   • закреплённые темы форума
--   • мут пользователей
--   • список запрещённых слов
--   • баннер профиля и GIF-аватарки (с проверкой админом)
-- Выполните ПОСЛЕ файлов 1–4. Можно запускать повторно. Пароль админки не трогает.
-- =====================================================================

-- ---------- Закреплённые темы ----------
alter table public.forum_posts add column if not exists pinned boolean not null default false;
create index if not exists forum_posts_pinned_idx on public.forum_posts (pinned desc, created_at desc);

-- ---------- Мут и баннер в профиле ----------
alter table public.profiles add column if not exists muted_until timestamptz;
alter table public.profiles add column if not exists mute_reason text;
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists banner_pending text;

-- хранилище: GIF и файлы до 5 МБ (баннеры)
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'avatars';

-- ---------- Запрещённые слова ----------
-- «слово»  — запрещено только это слово целиком («бля», но не «бляшки»)
-- «слово*» — запрещены все слова, которые так начинаются («дебил*» → «дебилы», «дебильный»)
-- части слов внутри других слов не ловятся: «урод» не найдёт «огород»
create table if not exists public.banned_words (
  word       text primary key,
  created_at timestamptz not null default now()
);
alter table public.banned_words drop constraint if exists banned_words_word_check;
alter table public.banned_words add constraint banned_words_word_check check (word ~ '^[а-яa-z0-9]{2,40}\*?$');

alter table public.banned_words enable row level security;
drop policy if exists "Слова: только админ" on public.banned_words;
create policy "Слова: только админ" on public.banned_words
  for all using (public.is_admin()) with check (public.is_admin());

-- стартовый список, его можно менять в админке
insert into public.banned_words (word) values
  ('хуй'), ('хуе*'), ('хуи*'), ('хуя*'), ('пизд*'), ('ебан*'), ('ебат*'), ('ебал*'), ('еблан*'), ('долбоеб*'), ('долбаеб*'),
  ('уебок*'), ('уебан*'), ('заеб*'), ('выеб*'), ('нахуй'), ('похуй'), ('бля'), ('блят*'), ('бляд*'),
  ('сука'), ('суки'), ('сучк*'), ('мудак*'), ('мудил*'), ('пидор*'), ('пидар*'), ('гандон*'), ('шлюх*'),
  ('даун'), ('дауны'), ('дебил*'), ('идиот*'), ('урод'), ('уроды'), ('уродина'), ('тварь'), ('твари')
on conflict do nothing;

-- первое найденное запрещённое слово в тексте (или null)
create or replace function public.find_banned_word(txt text)
returns text
language sql
stable
security definer set search_path = ''
as $$
  select w.word
  from public.banned_words w
  where lower(translate(coalesce(txt, ''), 'Ёё', 'ее')) ~ (
    '(^|[^а-яa-z0-9])' ||
    case when right(w.word, 1) = '*' then left(w.word, -1)
         else w.word || '($|[^а-яa-z0-9])' end
  )
  limit 1;
$$;
revoke execute on function public.find_banned_word(text) from public, anon, authenticated;

-- проверка текста с сайта: только «да/нет», сам список не раскрывается
create or replace function public.check_text(txt text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.find_banned_word(txt) is null;
$$;
grant execute on function public.check_text(text) to anon, authenticated;

-- ---------- Форум: мут и запрещённые слова проверяет сама база ----------
create or replace function public.set_forum_author()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  new.author_id := auth.uid();

  select muted_until into until from public.profiles where id = auth.uid();
  if until is not null and until > now() then
    raise exception 'Вы не можете писать на форуме до % (МСК)',
      to_char(until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
  end if;

  if public.find_banned_word(coalesce(to_jsonb(new) ->> 'title', '') || ' ' || coalesce(new.body, '')) is not null then
    raise exception 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  end if;

  new.author_name := coalesce(nullif((select name from public.profiles where id = auth.uid()), ''), 'Пользователь');
  return new;
end;
$$;

-- закреплять темы может только админ, поэтому author/pinned при создании не подделать
create or replace function public.forum_post_defaults()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then new.pinned := false; end if;
  return new;
end;
$$;
drop trigger if exists forum_posts_defaults on public.forum_posts;
create trigger forum_posts_defaults before insert on public.forum_posts
  for each row execute procedure public.forum_post_defaults();

-- ---------- Форма «Свяжитесь с нами» ----------
create or replace function public.check_contact_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if public.find_banned_word(new.name || ' ' || new.message) is not null then
    raise exception 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  end if;
  return new;
end;
$$;
drop trigger if exists contact_messages_check on public.contact_messages;
create trigger contact_messages_check before insert on public.contact_messages
  for each row execute procedure public.check_contact_message();

-- ---------- Ник ----------
create or replace function public.check_profile_name()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if public.find_banned_word(new.name) is not null then
    if tg_op = 'INSERT' then
      new.name := 'Пользователь';  -- при регистрации не ломаем создание аккаунта
    else
      raise exception 'Ник содержит недопустимые слова';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_name_check on public.profiles;
create trigger profiles_name_check before insert or update of name on public.profiles
  for each row execute procedure public.check_profile_name();

-- ---------- Фото и баннеры: заявка пользователя ----------
-- возвращает 'approved' (админ — ставится сразу) или 'pending' (ждёт проверки)
drop function if exists public.request_media(text, text);
create function public.request_media(kind text, path text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if kind not in ('avatar', 'banner') then raise exception 'Неизвестный тип файла'; end if;
  if path is null or split_part(path, '/', 1) <> auth.uid()::text then raise exception 'Неверный путь к файлу'; end if;
  if kind = 'avatar' then
    if admin then
      update public.profiles set avatar_url = path, avatar_pending = null where id = auth.uid();
    else
      update public.profiles set avatar_pending = path where id = auth.uid();
    end if;
  else
    if admin then
      update public.profiles set banner_url = path, banner_pending = null where id = auth.uid();
    else
      update public.profiles set banner_pending = path where id = auth.uid();
    end if;
  end if;
  return case when admin then 'approved' else 'pending' end;
end;
$$;

create or replace function public.remove_media(kind text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if kind = 'avatar' then
    update public.profiles set avatar_url = null, avatar_pending = null where id = auth.uid();
  elsif kind = 'banner' then
    update public.profiles set banner_url = null, banner_pending = null where id = auth.uid();
  end if;
end;
$$;

-- ---------- Публичный профиль (без почты) ----------
drop function if exists public.public_profiles(uuid[]);
create function public.public_profiles(ids uuid[])
returns table (id uuid, name text, avatar_url text, banner_url text, created_at timestamptz)
language sql
stable
security definer set search_path = ''
as $$
  select p.id, p.name, p.avatar_url, p.banner_url, p.created_at from public.profiles p where p.id = any(ids);
$$;
grant execute on function public.public_profiles(uuid[]) to anon, authenticated;

-- ---------- Админ ----------
create or replace function public.admin_media_requests()
returns table (id uuid, email text, name text, kind text, pending text, current_path text)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select p.id, u.email::text, p.name, 'avatar'::text, p.avatar_pending, p.avatar_url
      from public.profiles p join auth.users u on u.id = p.id where p.avatar_pending is not null
    union all
    select p.id, u.email::text, p.name, 'banner'::text, p.banner_pending, p.banner_url
      from public.profiles p join auth.users u on u.id = p.id where p.banner_pending is not null;
end;
$$;

create or replace function public.admin_review_media(target uuid, kind text, approve boolean)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  pending text;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if kind = 'avatar' then
    select avatar_pending into pending from public.profiles where id = target;
    update public.profiles
      set avatar_url = case when approve then avatar_pending else avatar_url end, avatar_pending = null
      where id = target;
  elsif kind = 'banner' then
    select banner_pending into pending from public.profiles where id = target;
    update public.profiles
      set banner_url = case when approve then banner_pending else banner_url end, banner_pending = null
      where id = target;
  else
    raise exception 'Неизвестный тип файла';
  end if;
  return pending;
end;
$$;

create or replace function public.admin_pin_post(post_id bigint, pin boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.forum_posts set pinned = pin where id = post_id;
end;
$$;

-- мут: until = null снимает мут
create or replace function public.admin_mute(target uuid, until timestamptz, reason text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if target = auth.uid() then raise exception 'Нельзя замутить самого себя'; end if;
  update public.profiles set muted_until = until, mute_reason = case when until is null then null else reason end
  where id = target;
end;
$$;

drop function if exists public.admin_users();
create function public.admin_users()
returns table (
  id uuid, email text, name text, plan text, role text,
  created_at timestamptz, confirmed boolean, last_sign_in_at timestamptz,
  muted_until timestamptz, mute_reason text
)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select u.id, u.email::text, coalesce(p.name, ''), coalesce(p.plan, 'basic'), coalesce(p.role, 'user'),
           u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at,
           p.muted_until, p.mute_reason
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return json_build_object(
    'users',           (select count(*) from auth.users),
    'confirmed',       (select count(*) from auth.users where email_confirmed_at is not null),
    'new_week',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'posts',           (select count(*) from public.forum_posts),
    'replies',         (select count(*) from public.forum_replies),
    'rations',         (select count(*) from public.rations),
    'diary',           (select count(*) from public.food_diary),
    'messages',        (select count(*) from public.contact_messages),
    'avatars_pending', (select count(*) from public.profiles where avatar_pending is not null)
                     + (select count(*) from public.profiles where banner_pending is not null),
    'muted',           (select count(*) from public.profiles where muted_until > now())
  );
end;
$$;

revoke execute on function public.request_media(text, text), public.remove_media(text),
  public.admin_media_requests(), public.admin_review_media(uuid, text, boolean),
  public.admin_pin_post(bigint, boolean), public.admin_mute(uuid, timestamptz, text),
  public.admin_users(), public.admin_stats() from public, anon;
grant execute on function public.request_media(text, text), public.remove_media(text),
  public.admin_media_requests(), public.admin_review_media(uuid, text, boolean),
  public.admin_pin_post(bigint, boolean), public.admin_mute(uuid, timestamptz, text),
  public.admin_users(), public.admin_stats() to authenticated;
