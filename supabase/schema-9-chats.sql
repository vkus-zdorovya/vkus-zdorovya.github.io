-- =====================================================================
-- ВкусЗдоровья — часть 9: беседы, голосовые, фото и файлы в чатах
--   • conversations / conversation_members / chat_messages — личные чаты и беседы до 50 человек
--   • закрытое хранилище «chat»: вложения видят только участники беседы
--   • старые личные сообщения (direct_messages) переносятся автоматически
-- Выполните ПОСЛЕ файлов 1–8. Можно запускать повторно. Пароль админки не трогает.
-- =====================================================================

-- ---------- Таблицы ----------
create table if not exists public.conversations (
  id         bigint generated always as identity primary key,
  title      text check (char_length(title) <= 60),
  is_group   boolean not null default false,
  direct_key text unique,                       -- для личного чата: «uuid1:uuid2», чтобы не было двух одинаковых
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'member')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.chat_messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  sender_id       uuid references auth.users (id) on delete set null,
  body            text check (char_length(body) <= 4000),
  kind            text not null default 'text' check (kind in ('text', 'image', 'file', 'voice', 'system')),
  file_path       text,
  file_name       text check (char_length(file_name) <= 200),
  file_size       bigint check (file_size between 0 and 20971520),
  file_type       text check (char_length(file_type) <= 120),
  duration        numeric check (duration between 0 and 600),
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, created_at desc);

-- ---------- Кто участник ----------
create or replace function public.chat_is_member(conv bigint)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.conversation_members where conversation_id = conv and user_id = auth.uid());
$$;

-- путь файла в хранилище: «<id беседы>/…» — доступ только участникам
create or replace function public.chat_path_allowed(path text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case when split_part(path, '/', 1) ~ '^[0-9]{1,18}$'
              then public.chat_is_member(split_part(path, '/', 1)::bigint) else false end;
$$;

-- ---------- Права на таблицы ----------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Беседы: видят участники" on public.conversations;
create policy "Беседы: видят участники" on public.conversations
  for select to authenticated using (public.chat_is_member(id));

drop policy if exists "Участники: видят участники" on public.conversation_members;
create policy "Участники: видят участники" on public.conversation_members
  for select to authenticated using (public.chat_is_member(conversation_id));

drop policy if exists "Чат: читают участники" on public.chat_messages;
create policy "Чат: читают участники" on public.chat_messages
  for select to authenticated using (public.chat_is_member(conversation_id));

drop policy if exists "Чат: пишут участники" on public.chat_messages;
create policy "Чат: пишут участники" on public.chat_messages
  for insert to authenticated with check (sender_id = auth.uid() and public.chat_is_member(conversation_id));

drop policy if exists "Чат: удалять свои" on public.chat_messages;
create policy "Чат: удалять свои" on public.chat_messages
  for delete to authenticated using (sender_id = auth.uid());

-- беседы и участников меняют только функции ниже
revoke all on public.conversations, public.conversation_members, public.chat_messages from anon;
revoke insert, update, delete on public.conversations, public.conversation_members from authenticated;
revoke update on public.chat_messages from authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;

-- ---------- Проверки сообщения ----------
create or replace function public.chat_message_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  -- служебные строки и перенос старых сообщений делают функции этого файла — их не проверяем
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
drop trigger if exists chat_messages_check on public.chat_messages;
create trigger chat_messages_check before insert on public.chat_messages
  for each row execute procedure public.chat_message_check();

-- служебная строка в беседе: «Аня добавила Борю»
create or replace function public.chat_system(conv bigint, text_ text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform set_config('app.chat_internal', '1', true);
  insert into public.chat_messages (conversation_id, sender_id, body, kind) values (conv, null, left(text_, 4000), 'system');
  perform set_config('app.chat_internal', '', true);
end;
$$;
revoke execute on function public.chat_system(bigint, text) from public, anon, authenticated;

create or replace function public.chat_name(uid uuid)
returns text
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(nullif((select name from public.profiles where id = uid), ''), 'Пользователь');
$$;

-- ---------- Функции для сайта ----------

-- личный чат с человеком: находит существующий или создаёт новый
create or replace function public.chat_open_direct(peer uuid)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  key text;
  conv bigint;
begin
  if me is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if peer is null or peer = me then raise exception 'Нельзя написать самому себе'; end if;
  if not exists (select 1 from auth.users where id = peer) then raise exception 'Пользователь не найден'; end if;
  key := least(me::text, peer::text) || ':' || greatest(me::text, peer::text);
  select id into conv from public.conversations where direct_key = key;
  if conv is null then
    insert into public.conversations (is_group, direct_key, created_by) values (false, key, me) returning id into conv;
    insert into public.conversation_members (conversation_id, user_id, role) values (conv, me, 'owner'), (conv, peer, 'member')
      on conflict do nothing;
  end if;
  return conv;
end;
$$;

-- новая беседа: название + участники (до 50 человек вместе с создателем)
create or replace function public.chat_create_group(title text, members uuid[])
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  conv bigint;
  t text := btrim(coalesce(title, ''));
  ids uuid[];
begin
  if me is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if char_length(t) < 1 or char_length(t) > 60 then raise exception 'Название беседы — от 1 до 60 символов'; end if;
  if public.find_banned_word(t) is not null then raise exception 'Название содержит недопустимые слова'; end if;
  select coalesce(array_agg(distinct u.id), '{}') into ids
    from unnest(coalesce(members, '{}')) m join auth.users u on u.id = m where m <> me;
  if array_length(ids, 1) is null then raise exception 'Добавьте хотя бы одного участника'; end if;
  if array_length(ids, 1) > 49 then raise exception 'В беседе может быть не больше 50 человек'; end if;
  if (select count(*) from public.conversations where created_by = me and is_group and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Слишком много новых бесед. Попробуйте через час';
  end if;

  insert into public.conversations (title, is_group, created_by) values (t, true, me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, role) values (conv, me, 'owner');
  insert into public.conversation_members (conversation_id, user_id) select conv, unnest(ids);
  perform public.chat_system(conv, public.chat_name(me) || ' создал(а) беседу «' || t || '»');
  return conv;
end;
$$;

-- добавить людей в беседу может любой её участник
create or replace function public.chat_add_members(conv bigint, members uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  added text;
begin
  if not public.chat_is_member(conv) then raise exception 'Нет доступа'; end if;
  if not (select is_group from public.conversations where id = conv) then raise exception 'В личный чат нельзя добавить людей — создайте беседу'; end if;
  if (select count(*) from public.conversation_members where conversation_id = conv)
     + (select count(*) from unnest(members) m where not exists (select 1 from public.conversation_members x where x.conversation_id = conv and x.user_id = m)) > 50 then
    raise exception 'В беседе может быть не больше 50 человек';
  end if;
  with ins as (
    insert into public.conversation_members (conversation_id, user_id)
    select conv, u.id from unnest(members) m join auth.users u on u.id = m
    on conflict do nothing
    returning user_id
  )
  select string_agg(public.chat_name(user_id), ', ') into added from ins;
  if added is not null then
    perform public.chat_system(conv, public.chat_name(me) || ' добавил(а): ' || added);
  end if;
end;
$$;

-- исключить участника может создатель беседы
create or replace function public.chat_remove_member(conv bigint, member uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversation_members where conversation_id = conv and user_id = auth.uid() and role = 'owner') then
    raise exception 'Исключать участников может только создатель беседы';
  end if;
  if member = auth.uid() then raise exception 'Чтобы уйти из беседы, нажмите «Выйти из беседы»'; end if;
  delete from public.conversation_members where conversation_id = conv and user_id = member;
  if found then perform public.chat_system(conv, public.chat_name(auth.uid()) || ' исключил(а) ' || public.chat_name(member)); end if;
end;
$$;

-- выйти из беседы; если создатель уходит — права переходят самому давнему участнику
create or replace function public.chat_leave(conv bigint)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  was_owner boolean;
begin
  if not (select is_group from public.conversations where id = conv) then raise exception 'Из личного чата нельзя выйти'; end if;
  delete from public.conversation_members where conversation_id = conv and user_id = me returning role = 'owner' into was_owner;
  if not found then return; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = conv) then
    delete from public.conversations where id = conv;
    return;
  end if;
  if was_owner then
    update public.conversation_members set role = 'owner'
     where conversation_id = conv and user_id = (select user_id from public.conversation_members where conversation_id = conv order by joined_at limit 1);
  end if;
  perform public.chat_system(conv, public.chat_name(me) || ' вышел(ла) из беседы');
end;
$$;

-- переименовать беседу может любой участник
create or replace function public.chat_rename(conv bigint, title text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  t text := btrim(coalesce(title, ''));
begin
  if not public.chat_is_member(conv) then raise exception 'Нет доступа'; end if;
  if not (select is_group from public.conversations where id = conv) then raise exception 'Личный чат нельзя переименовать'; end if;
  if char_length(t) < 1 or char_length(t) > 60 then raise exception 'Название беседы — от 1 до 60 символов'; end if;
  if public.find_banned_word(t) is not null then raise exception 'Название содержит недопустимые слова'; end if;
  update public.conversations set title = t where id = conv;
  perform public.chat_system(conv, public.chat_name(auth.uid()) || ' переименовал(а) беседу в «' || t || '»');
end;
$$;

create or replace function public.chat_mark_read(conv bigint)
returns void
language sql
security definer set search_path = ''
as $$
  update public.conversation_members set last_read_at = now() where conversation_id = conv and user_id = auth.uid();
$$;

-- список моих чатов: название, собеседник (для личного), последнее сообщение, непрочитанные
drop function if exists public.chat_list();
create function public.chat_list()
returns table (
  id bigint, title text, is_group boolean, peer_id uuid, peer_avatar text, members integer,
  last_body text, last_kind text, last_sender text, last_from_me boolean, last_at timestamptz, unread integer
)
language sql
stable
security definer set search_path = ''
as $$
  select c.id,
         case when c.is_group then c.title else public.chat_name(peer.user_id) end,
         c.is_group, peer.user_id, pp.avatar_url,
         (select count(*) from public.conversation_members x where x.conversation_id = c.id)::int,
         lm.body, lm.kind, case when lm.sender_id is null then null else public.chat_name(lm.sender_id) end,
         lm.sender_id = auth.uid(), coalesce(lm.created_at, c.created_at),
         (select count(*) from public.chat_messages m
           where m.conversation_id = c.id and m.created_at > me.last_read_at
             and m.sender_id is distinct from auth.uid() and m.kind <> 'system')::int
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    left join lateral (select x.user_id from public.conversation_members x
                        where not c.is_group and x.conversation_id = c.id and x.user_id <> auth.uid() limit 1) peer on true
    left join public.profiles pp on pp.id = peer.user_id
    left join lateral (select m.body, m.kind, m.sender_id, m.created_at from public.chat_messages m
                        where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
   where me.user_id = auth.uid()
   order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- участники беседы с никами и аватарками
drop function if exists public.chat_members(bigint);
create function public.chat_members(conv bigint)
returns table (user_id uuid, name text, avatar_url text, role text, last_read_at timestamptz)
language sql
stable
security definer set search_path = ''
as $$
  select m.user_id, public.chat_name(m.user_id), p.avatar_url, m.role, m.last_read_at
    from public.conversation_members m left join public.profiles p on p.id = m.user_id
   where m.conversation_id = conv and public.chat_is_member(conv)
   order by m.role = 'owner' desc, m.joined_at;
$$;

create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select count(*)::int from public.conversation_members me
    join public.chat_messages m on m.conversation_id = me.conversation_id
   where me.user_id = auth.uid() and m.created_at > me.last_read_at
     and m.sender_id is distinct from auth.uid() and m.kind <> 'system';
$$;

revoke execute on function public.chat_open_direct(uuid), public.chat_create_group(text, uuid[]),
  public.chat_add_members(bigint, uuid[]), public.chat_remove_member(bigint, uuid), public.chat_leave(bigint),
  public.chat_rename(bigint, text), public.chat_mark_read(bigint), public.chat_list(), public.chat_members(bigint),
  public.chat_unread_count(), public.chat_is_member(bigint), public.chat_path_allowed(text), public.chat_name(uuid) from public, anon;
grant execute on function public.chat_open_direct(uuid), public.chat_create_group(text, uuid[]),
  public.chat_add_members(bigint, uuid[]), public.chat_remove_member(bigint, uuid), public.chat_leave(bigint),
  public.chat_rename(bigint, text), public.chat_mark_read(bigint), public.chat_list(), public.chat_members(bigint),
  public.chat_unread_count(), public.chat_is_member(bigint), public.chat_path_allowed(text), public.chat_name(uuid) to authenticated;

-- ---------- Закрытое хранилище вложений ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 20971520, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav',
  'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Чат: участники читают файлы" on storage.objects;
create policy "Чат: участники читают файлы" on storage.objects
  for select to authenticated using (bucket_id = 'chat' and public.chat_path_allowed(name));

drop policy if exists "Чат: участники загружают файлы" on storage.objects;
create policy "Чат: участники загружают файлы" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat' and public.chat_path_allowed(name));

-- ---------- Перенос старых личных сообщений ----------
do $$
declare
  r record;
  conv bigint;
begin
  if to_regclass('public.direct_messages') is null then return; end if;
  for r in
    select distinct least(sender_id::text, recipient_id::text) as a, greatest(sender_id::text, recipient_id::text) as b
      from public.direct_messages
  loop
    if exists (select 1 from public.conversations where direct_key = r.a || ':' || r.b) then continue; end if;
    insert into public.conversations (is_group, direct_key, created_by) values (false, r.a || ':' || r.b, r.a::uuid) returning id into conv;
    insert into public.conversation_members (conversation_id, user_id, role)
      values (conv, r.a::uuid, 'owner'), (conv, r.b::uuid, 'member') on conflict do nothing;
    -- проверки для переноса не нужны: сообщения уже прошли их раньше, а дата должна сохраниться
    perform set_config('app.chat_internal', '1', true);
    insert into public.chat_messages (conversation_id, sender_id, body, kind, created_at)
      select conv, d.sender_id, d.body, 'text', d.created_at from public.direct_messages d
       where least(d.sender_id::text, d.recipient_id::text) = r.a and greatest(d.sender_id::text, d.recipient_id::text) = r.b
       order by d.created_at;
    perform set_config('app.chat_internal', '', true);
  end loop;
end $$;
