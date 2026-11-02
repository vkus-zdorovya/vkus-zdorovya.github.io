-- =====================================================================
-- Укропчик — часть 3: панель администратора
-- Выполните ПОСЛЕ schema.sql и schema-2-personal.sql.
-- Можно запускать повторно — ничего не сломается.
--
-- !!! Перед запуском замените ПАРОЛЬ-АДМИНА (строка ниже, в блоке «Пароль») на свой.
--     Пароль хранится в базе только в зашифрованном виде.
--     Чтобы сменить пароль позже — запустите этот файл ещё раз с новым паролем.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Роль пользователя ----------
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));

-- пользователь может менять у себя только имя и план, но не роль
revoke update on public.profiles from anon, authenticated;
grant update (name, plan) on public.profiles to authenticated;

-- ---------- Закрытая схема: недоступна из браузера ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_settings (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);

create table if not exists private.admin_attempts (
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

-- ---------- Пароль ----------
insert into private.admin_settings (id, password_hash)
values (1, extensions.crypt('ПАРОЛЬ-АДМИНА', extensions.gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;

-- ---------- Проверка прав ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- вход в админку по паролю: не больше 5 попыток за 15 минут
create or replace function public.admin_claim(password text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите в аккаунт';
  end if;
  if (select count(*) from private.admin_attempts
      where user_id = auth.uid() and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Слишком много попыток. Подождите 15 минут';
  end if;

  select extensions.crypt(password, password_hash) = password_hash into ok
  from private.admin_settings where id = 1;

  if coalesce(ok, false) then
    update public.profiles set role = 'admin' where id = auth.uid();
    delete from private.admin_attempts where user_id = auth.uid();
    return true;
  end if;

  insert into private.admin_attempts (user_id) values (auth.uid());
  return false;
end;
$$;

-- ---------- Статистика ----------
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return json_build_object(
    'users',     (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'new_week',  (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'posts',     (select count(*) from public.forum_posts),
    'replies',   (select count(*) from public.forum_replies),
    'rations',   (select count(*) from public.rations),
    'diary',     (select count(*) from public.food_diary),
    'messages',  (select count(*) from public.contact_messages)
  );
end;
$$;

-- ---------- Пользователи ----------
create or replace function public.admin_users()
returns table (
  id uuid, email text, name text, plan text, role text,
  created_at timestamptz, confirmed boolean, last_sign_in_at timestamptz
)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select u.id, u.email::text, coalesce(p.name, ''), coalesce(p.plan, 'basic'), coalesce(p.role, 'user'),
           u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_set_plan(target uuid, new_plan text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.profiles set plan = new_plan where id = target;
end;
$$;

create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if target = auth.uid() then raise exception 'Нельзя удалить свой аккаунт из админки'; end if;
  delete from auth.users where id = target;
end;
$$;

-- админские функции может вызывать только вошедший пользователь (права всё равно проверяются внутри)
revoke execute on function public.admin_claim(text), public.admin_stats(), public.admin_users(),
  public.admin_set_plan(uuid, text), public.admin_set_role(uuid, text), public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_claim(text), public.admin_stats(), public.admin_users(),
  public.admin_set_plan(uuid, text), public.admin_set_role(uuid, text), public.admin_delete_user(uuid) to authenticated;

-- ---------- Права администратора на данные ----------
drop policy if exists "Темы: админ удаляет" on public.forum_posts;
create policy "Темы: админ удаляет" on public.forum_posts
  for delete using (public.is_admin());

drop policy if exists "Ответы: админ удаляет" on public.forum_replies;
create policy "Ответы: админ удаляет" on public.forum_replies
  for delete using (public.is_admin());

drop policy if exists "Сообщения: админ читает" on public.contact_messages;
create policy "Сообщения: админ читает" on public.contact_messages
  for select using (public.is_admin());

drop policy if exists "Сообщения: админ удаляет" on public.contact_messages;
create policy "Сообщения: админ удаляет" on public.contact_messages
  for delete using (public.is_admin());
