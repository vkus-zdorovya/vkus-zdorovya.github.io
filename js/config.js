/*
 * Настройки подключения к базе данных Supabase.
 *
 * 1. Создайте проект на https://supabase.com (бесплатно).
 * 2. Выполните файл supabase/schema.sql в разделе SQL Editor.
 * 3. Скопируйте значения из Project Settings → API:
 *      Project URL      → SUPABASE_URL
 *      anon public key  → SUPABASE_ANON_KEY
 *
 * Ключ anon — публичный, его можно хранить в коде сайта: доступ к данным
 * ограничивают правила Row Level Security из schema.sql.
 *
 * Пока поля пустые, сайт работает в демо-режиме и хранит данные в браузере.
 *
 * SUPABASE_PROXY — путь, через который сайт ходит в базу через свой домен.
 * На Netlify это правила из _redirects, на обычном хостинге — proxy.php и .htaccess.
 * Так база работает в России без VPN.
 * На хостах из DIRECT_HOSTS (там прокси нет) и на localhost запросы идут напрямую.
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://afzroggvqgadcozukiwy.supabase.co',
  SUPABASE_PROXY: '/sb',
  DIRECT_HOSTS: ['github.io'],
  // общая почта сайта: с неё уходят ответы из админки
  SITE_EMAIL: 'info.oooukropchik@gmail.com',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmenJvZ2d2cWdhZGNvenVraXd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNzEwNDUsImV4cCI6MjEwODc0NzA0NX0.JVwHKHXWD1iD0MVjo2dGut7WWOlYTSZ54qlIpOpqhPc',
};

/* true — если у хостинга есть прокси /sb, /off, /dns */
window.APP_CONFIG.useProxy = !(
  location.protocol === 'file:' ||
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
  (window.APP_CONFIG.DIRECT_HOSTS || []).some((host) => location.hostname === host || location.hostname.endsWith('.' + host))
);
