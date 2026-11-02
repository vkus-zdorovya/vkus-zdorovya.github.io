-- =====================================================================
-- ВкусЗдоровья — часть 4: ник, аватарки с проверкой админом, ответы на сообщения
-- Выполните ПОСЛЕ schema.sql, schema-2-personal.sql и schema-3-admin.sql.
-- Можно запускать повторно — ничего не сломается. Пароль админки этот файл не трогает.
-- =====================================================================

-- ---------- Профиль ----------
alter table public.profiles add column if not exists avatar_url text;      -- одобренное фото (путь в хранилище)
alter table public.profiles add column if not exists avatar_pending text;  -- фото, ждущее проверки

alter table public.profiles drop constraint if exists profiles_name_check;
alter table public.profiles add constraint profiles_name_check check (char_length(name) <= 40) not valid;

-- ---------- Хранилище аватарок: до 2 МБ, только картинки ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- загружать можно только в свою папку: avatars/<id пользователя>/...
drop policy if exists "Аватарки: загрузка в свою папку" on storage.objects;
create policy "Аватарки: загрузка в свою папку" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Аватарки: удаление своих и админом" on storage.objects;
create policy "Аватарки: удаление своих и админом" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- Заявка на новое фото ----------
create or replace function public.request_avatar(path text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if path is null or split_part(path, '/', 1) <> auth.uid()::text then
    raise exception 'Неверный путь к файлу';
  end if;
  update public.profiles set avatar_pending = path where id = auth.uid();
end;
$$;

create or replace function public.remove_avatar()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  update public.profiles set avatar_url = null, avatar_pending = null where id = auth.uid();
end;
$$;

-- ---------- Имена и одобренные аватарки для форума (без почты и прочих данных) ----------
create or replace function public.public_profiles(ids uuid[])
returns table (id uuid, name text, avatar_url text)
language sql
stable
security definer set search_path = ''
as $$
  select p.id, p.name, p.avatar_url from public.profiles p where p.id = any(ids);
$$;

-- ---------- Админ: проверка фото ----------
create or replace function public.admin_avatar_requests()
returns table (id uuid, email text, name text, avatar_pending text, avatar_url text)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select p.id, u.email::text, p.name, p.avatar_pending, p.avatar_url
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.avatar_pending is not null
    order by p.created_at;
end;
$$;

-- одобрить или отклонить; возвращает путь к файлу, который был на проверке
create or replace function public.admin_review_avatar(target uuid, approve boolean)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  pending text;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select avatar_pending into pending from public.profiles where id = target;
  if approve then
    update public.profiles set avatar_url = avatar_pending, avatar_pending = null where id = target;
  else
    update public.profiles set avatar_pending = null where id = target;
  end if;
  return pending;
end;
$$;

-- статистика с числом фото на проверке
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
  );
end;
$$;

revoke execute on function public.request_avatar(text), public.remove_avatar(),
  public.admin_avatar_requests(), public.admin_review_avatar(uuid, boolean), public.admin_stats() from public, anon;
grant execute on function public.request_avatar(text), public.remove_avatar(),
  public.admin_avatar_requests(), public.admin_review_avatar(uuid, boolean), public.admin_stats() to authenticated;
grant execute on function public.public_profiles(uuid[]) to anon, authenticated;

-- ---------- Сообщения с сайта: отметка «Отвечено» ----------
alter table public.contact_messages add column if not exists answered_at timestamptz;

drop policy if exists "Сообщения: админ отмечает" on public.contact_messages;
create policy "Сообщения: админ отмечает" on public.contact_messages
  for update using (public.is_admin()) with check (public.is_admin());
