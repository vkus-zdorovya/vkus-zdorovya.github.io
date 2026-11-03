/* Общие элементы всех страниц: шапка, подвал, меню, уведомления, анимации появления */
(function () {
  const NAV = [
    ['index.html', 'Главная'],
    ['calculator.html', 'Калькулятор'],
    ['diet.html', 'Рацион'],
    ['recipes.html', 'Рецепты'],
    ['diary.html', 'Дневник'],
    ['scanner.html', 'Сканер'],
    ['forum.html', 'Форум'],
    ['account.html', 'Кабинет'],
  ];
  const FOOTER_NAV = [
    ['index.html', 'Главная'],
    ['index.html#about', 'О нас'],
    ['index.html#nutrition', 'Питание'],
    ['calculator.html', 'Калькулятор'],
    ['recipes.html', 'Рецепты'],
    ['forum.html', 'Форум'],
  ];

  const page = location.pathname.split('/').pop() || 'index.html';

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* аватарка: одобренное фото или первая буква имени */
  function avatarHtml(name, url, cls = '') {
    const letter = esc((String(name || '?').trim()[0] || '?').toUpperCase());
    return url
      ? `<span class="avatar ${cls}"><img src="${esc(url)}" alt="" loading="lazy"></span>`
      : `<span class="avatar ${cls}" aria-hidden="true">${letter}</span>`;
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function toast(text, type = 'ok') {
    let box = document.querySelector('.toast-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toast-box';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function renderHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;
    const links = NAV.map(([href, label]) => {
      const active = href === page ? ' class="active" aria-current="page"' : '';
      return `<a href="${href}"${active}>${label}</a>`;
    }).join('');
    header.className = 'site-header';
    header.innerHTML = `
      <div class="container">
        <a class="logo" href="index.html" aria-label="ВкусЗдоровья — на главную">
          <img src="img/logo.svg" alt="" width="40" height="40"><span>ВкусЗдоровья</span>
        </a>
        <nav class="nav" id="nav" aria-label="Основное меню">${links}</nav>
        <button class="icon-btn theme-btn" type="button" id="theme-btn"></button>
        <div class="header-actions" id="header-actions">
          <a class="btn btn-primary btn-sm" href="login.html">Войти</a>
        </div>
        <button class="burger" type="button" aria-label="Открыть меню" aria-expanded="false" aria-controls="nav"><span></span></button>
      </div>`;

    if (window.DB && DB.mode === 'demo') {
      const banner = document.createElement('div');
      banner.className = 'demo-banner';
      banner.textContent = 'Демо-режим: база данных не подключена, данные сохраняются только в этом браузере.';
      header.after(banner);
    }

    const burger = header.querySelector('.burger');
    const setOpen = (open) => {
      document.body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    };
    burger.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')));
    header.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  async function renderAuthState() {
    const box = document.getElementById('header-actions');
    if (!box || !window.DB) return null;
    let user = null;
    try {
      user = await DB.auth.getUser();
    } catch (err) {
      console.warn(err);
    }
    if (user) {
      box.innerHTML = `<a class="icon-btn dm-btn${page === 'messages.html' ? ' active' : ''}" href="messages.html" aria-label="Личные сообщения" title="Личные сообщения">✉️<span class="count-badge hidden" id="dm-badge"></span></a>
        <a class="user-chip post-author" href="account.html" title="${esc(user.email)}">${avatarHtml(user.name, user.avatar_url, 'avatar-sm')}<span class="chip-name">${esc(user.name)}</span></a>
        <button class="btn btn-ghost btn-sm" type="button" id="logout-btn">Выйти</button>`;
      if (user.role === 'admin') {
        const nav = document.getElementById('nav');
        if (nav && !nav.querySelector('[href="admin.html"]')) {
          nav.insertAdjacentHTML('beforeend', `<a href="admin.html"${page === 'admin.html' ? ' class="active" aria-current="page"' : ''}>Админ</a>`);
        }
      }
      refreshUnread();
      setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
      box.querySelector('#logout-btn').addEventListener('click', async () => {
        await DB.auth.signOut();
        location.reload();
      });
    }
    return user;
  }

  /* число непрочитанных личных сообщений на значке ✉️ */
  async function refreshUnread() {
    const badge = document.getElementById('dm-badge');
    if (!badge || !(DB.chat || DB.dm)) return;
    let n = 0;
    try { n = await (DB.chat || DB.dm).unread(); } catch { n = 0; }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', !n);
  }

  /* нажатие на аватарку с фото открывает её крупно */
  function initLightbox() {
    document.addEventListener('click', (e) => {
      const av = e.target.closest('.avatar.zoomable');
      const img = av && av.querySelector('img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Аватарка');
      box.innerHTML = `<img src="${esc(img.src)}" alt=""><button class="lightbox-close" type="button" aria-label="Закрыть">✕</button>`;
      const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      box.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
    }, true);
  }

  function renderFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;
    footer.className = 'site-footer';
    const links = FOOTER_NAV.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('');
    footer.innerHTML = `
      <div class="container footer-grid">
        <div class="footer-brand">
          <a class="logo" href="index.html"><img src="img/logo.svg" alt="" width="72" height="72"><span>ВкусЗдоровья</span></a>
          <p>Ваш надежный помощник в мире здорового питания.</p>
          <div class="socials">
            <a class="social" href="https://vk.ru/ykropchikoffc" target="_blank" rel="noopener" aria-label="ВкусЗдоровья ВКонтакте">VK</a>
            <a class="social" href="https://t.me/+BkpTLZr-AuQ0MTNi" target="_blank" rel="noopener" aria-label="ВкусЗдоровья в Telegram">TG</a>
          </div>
        </div>
        <div>
          <h4>Навигация</h4>
          <ul class="footer-links">${links}</ul>
        </div>
        <div>
          <h4>Контакты</h4>
          <ul class="footer-contacts">
            <li><span aria-hidden="true">📧</span><a href="mailto:info.oooukropchik@gmail.com">info.oooukropchik@gmail.com</a></li>
            <li><span aria-hidden="true">📞</span><a href="tel:+79515251175">+7 951 525-11-75</a></li>
            <li><span aria-hidden="true">📍</span><span>г. Калининград, ул. Горького, д. 166</span></li>
          </ul>
        </div>
        <div class="footer-legal">
          <h4>Юридическая информация</h4>
          <p>ИНН: ________</p>
          <p>ОГРН: ________</p>
          <p class="footer-copy">© ${new Date().getFullYear()} ВкусЗдоровья<br>Все права защищены</p>
        </div>
      </div>`;
  }

  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }

  function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const error = form.querySelector('.form-error');
      error.textContent = '';
      if (!data.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || !data.message.trim()) {
        error.textContent = 'Заполните имя, корректную почту и сообщение';
        return;
      }
      if (!(await DB.checkText(data.name + ' ' + data.message))) {
        error.textContent = 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await DB.contact.send({ name: data.name.trim(), email: data.email.trim(), message: data.message.trim() });
        form.reset();
        toast('Спасибо! Мы ответим вам на почту в ближайшее время.');
      } catch (err) {
        error.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ===================== Тема ===================== */

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';

  function setTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
      DB.store.set('theme', theme);
    } else {
      delete document.documentElement.dataset.theme;
      DB.store.remove('theme');
    }
    updateThemeButton();
  }

  function updateThemeButton() {
    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    const dark = isDark();
    btn.textContent = dark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    btn.title = btn.getAttribute('aria-label');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1510' : '#2d5f3b');
  }

  function initTheme() {
    const btn = document.getElementById('theme-btn');
    if (btn) btn.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
    darkQuery.addEventListener('change', updateThemeButton);
    updateThemeButton();
  }

  /* ===================== Приложение (PWA) ===================== */

  let installEvent = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function initPWA() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker:', err));
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installEvent = e;
      document.dispatchEvent(new Event('installable'));
      if (!DB.store.get('install_dismissed') && !document.querySelector('.install-bar')) showInstallBar();
    });
    window.addEventListener('appinstalled', () => {
      installEvent = null;
      document.querySelector('.install-bar')?.remove();
      toast('Приложение установлено!');
    });
  }

  function showInstallBar() {
    const bar = document.createElement('div');
    bar.className = 'install-bar';
    bar.innerHTML = `<img src="img/icon-192.png" alt="">
      <div><b>Установить «ВкусЗдоровья»</b><br><span class="muted">Как приложение на экран телефона</span></div>
      <button class="btn btn-primary btn-sm" type="button" data-install>Установить</button>
      <button class="icon-btn" type="button" data-close aria-label="Закрыть">✕</button>`;
    bar.querySelector('[data-install]').addEventListener('click', () => { install(); bar.remove(); });
    bar.querySelector('[data-close]').addEventListener('click', () => { DB.store.set('install_dismissed', true); bar.remove(); });
    document.body.appendChild(bar);
  }

  async function install() {
    if (!installEvent) return false;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    return outcome === 'accepted';
  }

  /* ===================== Напоминания о воде ===================== */
  /*
   * Работают, пока сайт или установленное приложение открыто (в том числе свёрнуто на компьютере).
   * Для уведомлений при полностью закрытом приложении нужен push-сервер.
   */

  const REMINDER_DEFAULTS = { on: false, every: 90, from: 9, to: 21 };
  let reminderTimer = null;

  function nextReminderTime(cfg, now = new Date()) {
    const last = DB.store.get('reminder_last', 0);
    let next = new Date(Math.max(now.getTime() + 60000, last + cfg.every * 60000));
    const start = (d) => { const x = new Date(d); x.setHours(cfg.from, 0, 0, 0); return x; };
    const end = (d) => { const x = new Date(d); x.setHours(cfg.to, 0, 0, 0); return x; };
    if (next < start(next)) next = start(next);
    if (next > end(next)) { next = start(next); next.setDate(next.getDate() + 1); }
    return next;
  }

  async function notify(title, body) {
    const options = { body, icon: 'img/icon-192.png', badge: 'img/icon-192.png', tag: 'water', data: { url: 'calculator.html#calc' } };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) return reg.showNotification(title, options);
      return new Notification(title, options);
    } catch (err) {
      console.warn(err);
      toast(`${title} ${body}`);
    }
  }

  function scheduleReminder() {
    clearTimeout(reminderTimer);
    const cfg = { ...REMINDER_DEFAULTS, ...DB.store.get('reminder', {}) };
    if (!cfg.on || !('Notification' in window) || Notification.permission !== 'granted') return null;
    const next = nextReminderTime(cfg);
    reminderTimer = setTimeout(() => {
      DB.store.set('reminder_last', Date.now());
      notify('Пора выпить воды 💧', 'Стакан воды сейчас — шаг к дневной норме.');
      scheduleReminder();
    }, Math.min(next - Date.now(), 2 ** 31 - 1));
    return next;
  }

  renderHeader();
  renderFooter();
  initTheme();
  initPWA();
  const userReady = renderAuthState();
  initReveal();
  initLightbox();
  initContactForm();
  scheduleReminder();

  window.UI = {
    esc, toast, formatDate, userReady, avatarHtml, refreshUnread,
    setTheme,
    theme: () => DB.store.get('theme') || 'system',
    install, canInstall: () => Boolean(installEvent), isStandalone, isIOS,
    notify, scheduleReminder, reminderDefaults: REMINDER_DEFAULTS,
  };
})();
