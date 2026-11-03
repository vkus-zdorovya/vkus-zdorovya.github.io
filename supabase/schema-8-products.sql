-- =====================================================================
-- ВкусЗдоровья — часть 8: своя база продуктов для сканера
--   • products — найденные товары (из Open Food Facts и добавленные участниками)
--   • product_requests — товары, которые добавили участники, ждут проверки админом
-- Выполните ПОСЛЕ файлов 1–7. Можно запускать повторно. Пароль админки не трогает.
-- =====================================================================

-- ---------- Товары ----------
-- data — карточка в формате Open Food Facts (название, бренд, КБЖУ на 100 г, состав)
create table if not exists public.products (
  barcode    text primary key check (barcode ~ '^[0-9]{6,14}$'),
  data       jsonb not null,
  source     text not null default 'off' check (source in ('off', 'user')),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- читать могут все, записывать — только функция сканера (ключ service_role) и админ через функции ниже
drop policy if exists "Товары: читать всем" on public.products;
create policy "Товары: читать всем" on public.products for select using (true);
revoke insert, update, delete on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;

-- ---------- Заявки на добавление товара ----------
create table if not exists public.product_requests (
  id         bigint generated always as identity primary key,
  barcode    text not null check (barcode ~ '^[0-9]{6,14}$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 120),
  brand      text check (char_length(brand) <= 80),
  quantity   text check (char_length(quantity) <= 40),
  kcal       numeric not null check (kcal between 0 and 950),
  protein    numeric not null check (protein between 0 and 100),
  fat        numeric not null check (fat between 0 and 100),
  carbs      numeric not null check (carbs between 0 and 100),
  sugars     numeric check (sugars between 0 and 100),
  salt       numeric check (salt between 0 and 100),
  ingredients text check (char_length(ingredients) <= 3000),
  is_drink   boolean not null default false,
  photo_path text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
-- два фото: лицевая сторона и сторона с таблицей КБЖУ и штрихкодом
alter table public.product_requests add column if not exists photo_label_path text;

create index if not exists product_requests_status_idx on public.product_requests (status, created_at);

alter table public.product_requests enable row level security;

drop policy if exists "Заявки товаров: добавлять" on public.product_requests;
create policy "Заявки товаров: добавлять" on public.product_requests
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Заявки товаров: свои и админ" on public.product_requests;
create policy "Заявки товаров: свои и админ" on public.product_requests
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

revoke update, delete on public.product_requests from anon, authenticated;
revoke all on public.product_requests from anon;
grant select, insert on public.product_requests to authenticated;

-- контрольная цифра штрихкода (EAN-8, UPC-A, EAN-13, GTIN-14): выдуманный номер почти всегда её не проходит
create or replace function public.gtin_valid(code text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  total int := 0;
  n int;
begin
  if code !~ '^[0-9]+$' or char_length(code) not in (8, 12, 13, 14) then return false; end if;
  n := char_length(code);
  -- справа налево без последней цифры: веса 3, 1, 3, 1…
  for i in 1 .. n - 1 loop
    total := total + substr(code, n - i, 1)::int * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  return (10 - total % 10) % 10 = substr(code, n, 1)::int;
end;
$$;

-- проверки при отправке: штрихкод, фото, мут, запрещённые слова, не больше 10 заявок в час, без повторов
create or replace function public.product_request_check()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  new.user_id := auth.uid();
  new.status := 'pending';
  new.created_at := now();
  if new.user_id is null then raise exception 'Сначала войдите в аккаунт'; end if;

  select muted_until into until from public.profiles where id = new.user_id;
  if until is not null and until > now() then
    raise exception 'Вы не можете добавлять товары до % (МСК)',
      to_char(until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
  end if;

  if public.find_banned_word(concat_ws(' ', new.name, new.brand, new.ingredients)) is not null then
    raise exception 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  end if;

  if not public.gtin_valid(new.barcode) then
    raise exception 'Штрихкод введён с ошибкой: не сходится контрольная цифра';
  end if;

  if new.photo_path is null or new.photo_label_path is null then
    raise exception 'Приложите два фото: лицевую сторону и сторону с составом и штрихкодом';
  end if;
  if split_part(new.photo_path, '/', 1) <> new.user_id::text
     or split_part(new.photo_label_path, '/', 1) <> new.user_id::text then
    raise exception 'Неверный путь к фото';
  end if;

  if exists (select 1 from public.product_requests
              where barcode = new.barcode and user_id = new.user_id and status = 'pending') then
    raise exception 'Вы уже отправили этот товар — он ждёт проверки';
  end if;

  if (select count(*) from public.product_requests
       where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Слишком много заявок подряд. Попробуйте через час';
  end if;
  return new;
end;
$$;
drop trigger if exists product_requests_check on public.product_requests;
create trigger product_requests_check before insert on public.product_requests
  for each row execute procedure public.product_request_check();

-- ---------- Админ: заявки и проверка ----------
drop function if exists public.admin_product_requests();
create function public.admin_product_requests()
returns table (
  id bigint, barcode text, name text, brand text, quantity text,
  kcal numeric, protein numeric, fat numeric, carbs numeric, sugars numeric, salt numeric,
  ingredients text, is_drink boolean, photo_path text, photo_label_path text, created_at timestamptz,
  author_name text, author_email text, existing boolean
)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select r.id, r.barcode, r.name, r.brand, r.quantity, r.kcal, r.protein, r.fat, r.carbs, r.sugars, r.salt,
           r.ingredients, r.is_drink, r.photo_path, r.photo_label_path, r.created_at,
           p.name, u.email::text, exists (select 1 from public.products x where x.barcode = r.barcode)
      from public.product_requests r
      left join public.profiles p on p.id = r.user_id
      left join auth.users u on u.id = r.user_id
     where r.status = 'pending'
     order by r.created_at;
end;
$$;

create or replace function public.admin_review_product(request_id bigint, approve boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  r public.product_requests;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select * into r from public.product_requests where id = request_id and status = 'pending';
  if not found then raise exception 'Заявка не найдена или уже проверена'; end if;

  update public.product_requests set status = case when approve then 'approved' else 'rejected' end where id = request_id;
  if not approve then return; end if;

  insert into public.products (barcode, data, source, updated_at)
  values (r.barcode, jsonb_strip_nulls(jsonb_build_object(
      'product_name', r.name,
      'brands', r.brand,
      'quantity', r.quantity,
      'ingredients_text_ru', r.ingredients,
      'image_path', r.photo_path,
      'categories_tags', case when r.is_drink then jsonb_build_array('en:beverages') else '[]'::jsonb end,
      'nutriments', jsonb_strip_nulls(jsonb_build_object(
        'energy-kcal_100g', r.kcal, 'proteins_100g', r.protein, 'fat_100g', r.fat,
        'carbohydrates_100g', r.carbs, 'sugars_100g', r.sugars, 'salt_100g', r.salt))
    )), 'user', now())
  on conflict (barcode) do update set data = excluded.data, source = 'user', updated_at = now();

  -- другие заявки на этот же штрихкод больше не нужны
  update public.product_requests set status = 'rejected'
   where barcode = r.barcode and status = 'pending' and id <> request_id;
end;
$$;

-- админ может убрать неправильный товар из базы
create or replace function public.admin_delete_product(code text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  delete from public.products where barcode = code;
end;
$$;

revoke execute on function public.admin_product_requests(), public.admin_review_product(bigint, boolean),
  public.admin_delete_product(text) from public, anon;
grant execute on function public.admin_product_requests(), public.admin_review_product(bigint, boolean),
  public.admin_delete_product(text) to authenticated;
