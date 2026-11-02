-- =====================================================================
-- ВкусЗдоровья — структура базы данных для Supabase
-- Можно запускать повторно — ничего не сломается.
-- Выполните целиком: Supabase → SQL Editor → New query → вставить → Run
-- =====================================================================

-- ---------- Профили пользователей ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null default '',
  plan       text not null default 'basic' check (plan in ('basic', 'personal')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Профиль: читать свой" on public.profiles;
create policy "Профиль: читать свой" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "Профиль: менять свой" on public.profiles;
create policy "Профиль: менять свой" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- профиль создаётся автоматически при регистрации
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Сохранённые рационы ----------
create table if not exists public.rations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.rations enable row level security;

drop policy if exists "Рационы: только свои" on public.rations;
create policy "Рационы: только свои" on public.rations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Форум ----------
create table if not exists public.forum_posts (
  id          bigint generated always as identity primary key,
  author_id   uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null default '',
  topic       text not null default 'Общее' check (char_length(topic) <= 40),
  title       text not null check (char_length(title) between 3 and 150),
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);

create table if not exists public.forum_replies (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.forum_posts on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text not null default '',
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists forum_replies_post_id_idx on public.forum_replies (post_id);

-- автор и его имя всегда берутся из сессии, подделать их из браузера нельзя
create or replace function public.set_forum_author()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  new.author_name := coalesce(nullif((select name from public.profiles where id = auth.uid()), ''), 'Пользователь');
  return new;
end;
$$;

drop trigger if exists forum_posts_author on public.forum_posts;
create trigger forum_posts_author before insert on public.forum_posts
  for each row execute procedure public.set_forum_author();

drop trigger if exists forum_replies_author on public.forum_replies;
create trigger forum_replies_author before insert on public.forum_replies
  for each row execute procedure public.set_forum_author();

alter table public.forum_posts enable row level security;
alter table public.forum_replies enable row level security;

drop policy if exists "Темы: читать всем" on public.forum_posts;
create policy "Темы: читать всем" on public.forum_posts
  for select using (true);
drop policy if exists "Темы: создавать после входа" on public.forum_posts;
create policy "Темы: создавать после входа" on public.forum_posts
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists "Темы: удалять свои" on public.forum_posts;
create policy "Темы: удалять свои" on public.forum_posts
  for delete using (auth.uid() = author_id);

drop policy if exists "Ответы: читать всем" on public.forum_replies;
create policy "Ответы: читать всем" on public.forum_replies
  for select using (true);
drop policy if exists "Ответы: писать после входа" on public.forum_replies;
create policy "Ответы: писать после входа" on public.forum_replies
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists "Ответы: удалять свои" on public.forum_replies;
create policy "Ответы: удалять свои" on public.forum_replies
  for delete using (auth.uid() = author_id);

-- ---------- Сообщения из формы «Свяжитесь с нами» ----------
-- читать их можно только в панели Supabase (Table Editor), с сайта — только отправить
create table if not exists public.contact_messages (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 100),
  email      text not null check (char_length(email) between 3 and 200),
  message    text not null check (char_length(message) between 1 and 3000),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "Сообщения: отправлять всем" on public.contact_messages;
create policy "Сообщения: отправлять всем" on public.contact_messages
  for insert to anon, authenticated with check (true);
