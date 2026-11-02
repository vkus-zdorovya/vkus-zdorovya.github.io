-- =====================================================================
-- ВкусЗдоровья — часть 6: личные сообщения и доработки админки
--   • личные сообщения между пользователями
--   • закреплённые комментарии в темах форума
--   • кнопка «Отметить „Отвечено“» и сохранение текста ответа
-- Выполните ПОСЛЕ файлов 1–5. Можно запускать повторно. Пароль админки не трогает.
-- =====================================================================

-- ---------- Закреплённые комментарии ----------
alter table public.forum_replies add column if not exists pinned boolean not null default false;

create or replace function public.forum_reply_defaults()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then new.pinned := false; end if;
  return new;
end;
$$;
drop trigger if exists forum_replies_defaults on public.forum_replies;
create trigger forum_replies_defaults before insert on public.forum_replies
  for each row execute procedure public.forum_reply_defaults();

create or replace function public.admin_pin_reply(reply_id bigint, pin boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.forum_replies set pinned = pin where id = reply_id;
end;
$$;

-- ---------- Сообщения с сайта: «Отвечено» ----------
alter table public.contact_messages add column if not exists answered_at timestamptz;
alter table public.contact_messages add column if not exists reply_text text;

create or replace function public.admin_mark_answered(message_id bigint, reply text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  update public.contact_messages
     set answered_at = now(), reply_text = coalesce(nullif(reply, ''), reply_text)
   where id = message_id;
  if not found then raise exception 'Сообщение не найдено'; end if;
end;
$$;

-- ---------- Личные сообщения ----------
create table if not exists public.direct_messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists direct_messages_pair_idx on public.direct_messages (sender_id, recipient_id, created_at desc);
create index if not exists direct_messages_inbox_idx on public.direct_messages (recipient_id, read_at);

alter table public.direct_messages enable row level security;

drop policy if exists "ЛС: видят участники" on public.direct_messages;
create policy "ЛС: видят участники" on public.direct_messages
  for select to authenticated using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "ЛС: отправлять от своего имени" on public.direct_messages;
create policy "ЛС: отправлять от своего имени" on public.direct_messages
  for insert to authenticated with check (auth.uid() = sender_id and recipient_id <> auth.uid());

drop policy if exists "ЛС: удалять свои" on public.direct_messages;
create policy "ЛС: удалять свои" on public.direct_messages
  for delete to authenticated using (auth.uid() = sender_id);

-- менять сообщения напрямую нельзя: «прочитано» ставит функция dm_mark_read
revoke update on public.direct_messages from anon, authenticated;
revoke all on public.direct_messages from anon;

-- проверки при отправке: мут, запрещённые слова, не больше 20 сообщений в минуту
create or replace function public.direct_message_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  new.sender_id := auth.uid();
  new.read_at := null;
  new.created_at := now();
  if new.sender_id is null then raise exception 'Сначала войдите в аккаунт'; end if;
  if new.recipient_id = new.sender_id then raise exception 'Нельзя написать самому себе'; end if;

  select muted_until into until from public.profiles where id = new.sender_id;
  if until is not null and until > now() then
    raise exception 'Вы не можете писать сообщения до % (МСК)',
      to_char(until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
  end if;

  if public.find_banned_word(new.body) is not null then
    raise exception 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  end if;

  if (select count(*) from public.direct_messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Слишком много сообщений подряд. Подождите минуту';
  end if;
  return new;
end;
$$;
drop trigger if exists direct_messages_check on public.direct_messages;
create trigger direct_messages_check before insert on public.direct_messages
  for each row execute procedure public.direct_message_check();

-- список диалогов: собеседник, последнее сообщение, сколько непрочитанных
drop function if exists public.dm_conversations();
create function public.dm_conversations()
returns table (peer_id uuid, name text, avatar_url text, last_body text, last_at timestamptz, last_from_me boolean, unread integer)
language sql
stable
security definer set search_path = ''
as $$
  with m as (
    select case when d.sender_id = auth.uid() then d.recipient_id else d.sender_id end as peer, d.*
      from public.direct_messages d
     where auth.uid() in (d.sender_id, d.recipient_id)
  ),
  last as (
    select distinct on (peer) peer, body, created_at, sender_id = auth.uid() as from_me
      from m order by peer, created_at desc
  )
  select l.peer, coalesce(p.name, 'Пользователь'), p.avatar_url, l.body, l.created_at, l.from_me,
         (select count(*) from m where m.peer = l.peer and m.recipient_id = auth.uid() and m.read_at is null)::int
    from last l left join public.profiles p on p.id = l.peer
   order by l.created_at desc;
$$;

create or replace function public.dm_unread_count()
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select count(*)::int from public.direct_messages where recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.dm_mark_read(peer uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.direct_messages set read_at = now()
   where recipient_id = auth.uid() and sender_id = peer and read_at is null;
$$;

-- ---------- Права ----------
revoke execute on function public.admin_pin_reply(bigint, boolean), public.admin_mark_answered(bigint, text),
  public.dm_conversations(), public.dm_unread_count(), public.dm_mark_read(uuid) from public, anon;
grant execute on function public.admin_pin_reply(bigint, boolean), public.admin_mark_answered(bigint, text),
  public.dm_conversations(), public.dm_unread_count(), public.dm_mark_read(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant select, insert, delete on public.direct_messages to authenticated;
