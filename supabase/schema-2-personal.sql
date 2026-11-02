-- =====================================================================
-- ВкусЗдоровья — часть 2: личный кабинет и дневник питания
-- Выполните ПОСЛЕ schema.sql: SQL Editor → New query → вставить → Run
-- =====================================================================

-- ---------- Дневник веса (одна запись на день) ----------
create table if not exists public.weight_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  date       date not null,
  weight     numeric(5, 1) not null check (weight between 20 and 400),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.weight_log enable row level security;
drop policy if exists "Вес: только свой" on public.weight_log;
create policy "Вес: только свой" on public.weight_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- История расчётов калькулятора ----------
create table if not exists public.calculations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.calculations enable row level security;
drop policy if exists "Расчёты: только свои" on public.calculations;
create policy "Расчёты: только свои" on public.calculations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Дневник питания ----------
create table if not exists public.food_diary (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  date       date not null,
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name       text not null check (char_length(name) between 1 and 200),
  grams      numeric(7, 1) not null check (grams > 0 and grams <= 5000),
  kcal       numeric(7, 1) not null check (kcal >= 0),
  protein    numeric(6, 1) not null default 0,
  fat        numeric(6, 1) not null default 0,
  carbs      numeric(6, 1) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists food_diary_user_date_idx on public.food_diary (user_id, date);

alter table public.food_diary enable row level security;
drop policy if exists "Дневник: только свой" on public.food_diary;
create policy "Дневник: только свой" on public.food_diary
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
