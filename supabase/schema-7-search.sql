-- =====================================================================
-- ВкусЗдоровья — часть 7: поиск участников по нику
-- Выполните ПОСЛЕ файлов 1–6. Можно запускать повторно. Пароль админки не трогает.
-- Возвращает только публичные данные: ник, аватарку, дату регистрации (без почты).
-- =====================================================================

drop function if exists public.search_profiles(text);
create function public.search_profiles(q text)
returns table (id uuid, name text, avatar_url text, created_at timestamptz, posts integer)
language sql
stable
security definer set search_path = ''
as $$
  with term as (
    -- спецсимволы LIKE экранируем, чтобы «%» и «_» искались как обычные буквы
    select lower(replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_')) as t
  )
  select p.id, p.name, p.avatar_url, p.created_at,
         (select count(*) from public.forum_posts f where f.author_id = p.id)::int
    from public.profiles p, term
   where char_length(term.t) between 2 and 40
     and coalesce(p.name, '') <> ''
     and lower(p.name) like '%' || term.t || '%'
   order by (lower(p.name) like term.t || '%') desc, char_length(p.name), p.name
   limit 20;
$$;

revoke execute on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to anon, authenticated;
