/* Админ-панель: статистика, пользователи, модерация форума, сообщения с сайта */
(function () {
  const { esc, toast, formatDate, userReady } = window.UI;
  const $ = (id) => document.getElementById(id);
  let me = null;
  let users = [];

  const showOnly = (id) => ['need-login', 'admin-login', 'panel'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
  const fmt = (iso) => (iso ? formatDate(iso) : '—');

  /* ---------- вход по паролю ---------- */

  const loginForm = $('admin-login');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = loginForm.querySelector('.form-error');
    const btn = loginForm.querySelector('button[type="submit"]');
    err.textContent = '';
    btn.disabled = true;
    try {
      const ok = await DB.admin.claim($('admin-pass').value);
      if (!ok) {
        err.textContent = 'Неверный пароль';
        return;
      }
      toast('Добро пожаловать в админ-панель');
      location.reload();
    } catch (error) {
      err.textContent = error.message;
    } finally {
      btn.disabled = false;
      $('admin-pass').value = '';
    }
  });

  $('admin-exit').addEventListener('click', async () => {
    if (!confirm('Выйти из режима администратора? Чтобы вернуться, понадобится пароль.')) return;
    try {
      await DB.admin.setRole(me.id, 'user');
      location.href = 'account.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- вкладки ---------- */

  const loaders = { overview: loadStats, users: loadUsers, avatars: loadAvatars, forum: loadForum, messages: loadMessages };
  $('admin-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    document.querySelectorAll('#admin-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== btn.dataset.tab));
    loaders[btn.dataset.tab]();
  });

  async function guard(box, fn) {
    try {
      await fn();
    } catch (error) {
      box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    }
  }

  /* ---------- обзор ---------- */

  function loadStats() {
    const box = $('stats');
    return guard(box, async () => {
      const s = await DB.admin.stats();
      const tiles = [
        ['👥 Пользователей', s.users, `новых за неделю: ${s.new_week}`],
        ['✅ Подтвердили почту', s.confirmed, ''],
        ['💬 Тем на форуме', s.posts, `ответов: ${s.replies}`],
        ['🗓 Сохранённых рационов', s.rations, ''],
        ['📔 Записей в дневниках', s.diary, ''],
        ['📩 Сообщений с сайта', s.messages, ''],
        ['🖼 Фото на проверке', s.avatars_pending || 0, ''],
      ];
      $('avatars-count').textContent = s.avatars_pending ? `(${s.avatars_pending})` : '';
      box.innerHTML = tiles.map(([label, value, note]) => `
        <div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${Number(value).toLocaleString('ru-RU')}</div>
        <div class="stat-note muted">${note}</div></div>`).join('');
    });
  }

  /* ---------- пользователи ---------- */

  function renderUsers() {
    const q = $('user-search').value.trim().toLowerCase();
    const list = users.filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    $('users').innerHTML = list.length ? `
      <table class="table">
        <tr><th>Имя</th><th>Почта</th><th>Роль</th><th>Регистрация</th><th>Последний вход</th><th></th></tr>
        ${list.map((u) => `
          <tr data-id="${esc(u.id)}">
            <td>${esc(u.name || '—')}</td>
            <td>${esc(u.email)} ${u.confirmed ? '' : '<span class="tag" title="Почта не подтверждена">не подтв.</span>'}</td>
            <td>${u.role === 'admin' ? '<span class="tag">админ</span>' : 'пользователь'}</td>
            <td>${fmt(u.created_at)}</td>
            <td>${fmt(u.last_sign_in_at)}</td>
            <td>${u.id === me.id ? '' : `
              <button class="btn btn-ghost btn-sm" type="button" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-user>Удалить</button>`}</td>
          </tr>`).join('')}
      </table>` : '<p class="muted">Никого не найдено.</p>';
  }

  function loadUsers() {
    return guard($('users'), async () => {
      users = await DB.admin.users();
      renderUsers();
    });
  }

  $('user-search').addEventListener('input', renderUsers);

  $('users').addEventListener('click', async (e) => {
    const row = e.target.closest('tr');
    if (!row) return;
    const u = users.find((x) => x.id === row.dataset.id);
    const roleBtn = e.target.closest('[data-role]');
    const delBtn = e.target.closest('[data-del-user]');
    try {
      if (roleBtn) {
        await DB.admin.setRole(u.id, roleBtn.dataset.role);
        toast(roleBtn.dataset.role === 'admin' ? `${u.email} теперь администратор` : `${u.email} больше не администратор`);
        loadUsers();
      }
      if (delBtn && confirm(`Удалить пользователя ${u.email}? Его рационы, дневник и сообщения на форуме тоже удалятся. Это нельзя отменить.`)) {
        await DB.admin.deleteUser(u.id);
        toast('Пользователь удалён');
        loadUsers();
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- проверка фото ---------- */

  function loadAvatars() {
    const box = $('avatar-requests');
    return guard(box, async () => {
      const list = await DB.admin.avatarRequests();
      $('avatars-count').textContent = list.length ? `(${list.length})` : '';
      box.innerHTML = list.length ? list.map((r) => `
        <div class="card avatar-request" data-id="${esc(r.id)}">
          <span class="avatar avatar-lg"><img src="${esc(r.pending_url)}" alt="Новое фото"></span>
          <div><b>${esc(r.name || '—')}</b><br><span class="small muted">${esc(r.email)}</span></div>
          ${r.current_url ? `<div class="small muted post-author">Сейчас: <span class="avatar avatar-sm"><img src="${esc(r.current_url)}" alt=""></span></div>` : ''}
          <div class="inline-form" style="justify-content:center">
            <button class="btn btn-primary btn-sm" type="button" data-approve>✓ Одобрить</button>
            <button class="btn btn-danger btn-sm" type="button" data-reject>✕ Отклонить</button>
          </div>
        </div>`).join('') : '<div class="card muted center" style="grid-column:1/-1">Новых фото нет.</div>';
    });
  }

  $('avatar-requests').addEventListener('click', async (e) => {
    const card = e.target.closest('.avatar-request');
    const approve = e.target.closest('[data-approve]');
    const reject = e.target.closest('[data-reject]');
    if (!card || (!approve && !reject)) return;
    try {
      await DB.admin.reviewAvatar(card.dataset.id, Boolean(approve));
      toast(approve ? 'Фото одобрено' : 'Фото отклонено');
      loadAvatars();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- форум ---------- */

  function loadForum() {
    const box = $('admin-posts');
    return guard(box, async () => {
      const posts = await DB.forum.list();
      box.innerHTML = posts.length ? posts.map((p) => `
        <article class="card post" data-id="${esc(String(p.id))}">
          <h3>${esc(p.title)}</h3>
          <div class="post-meta"><span class="badge">${esc(p.topic || 'Общее')}</span><span>👤 ${esc(p.author_name)}</span><span>${fmt(p.created_at)}</span></div>
          <div class="post-body clamped">${esc(p.body)}</div>
          <div class="post-foot">
            <button class="btn btn-ghost btn-sm" type="button" data-replies>💬 Ответы (${p.replies_count})</button>
            <button class="btn btn-danger btn-sm" type="button" data-del-post>Удалить тему</button>
          </div>
          <div class="replies hidden"></div>
        </article>`).join('') : '<div class="card muted center">Тем пока нет.</div>';
    });
  }

  async function showReplies(card) {
    const box = card.querySelector('.replies');
    box.classList.remove('hidden');
    const replies = await DB.forum.replies(card.dataset.id);
    box.innerHTML = replies.length ? replies.map((r) => `
      <div class="reply">
        <div class="post-meta"><span>👤 ${esc(r.author_name)}</span><span>${fmt(r.created_at)}</span></div>
        <div class="post-body">${esc(r.body)}</div>
        <button class="link-btn" type="button" data-del-reply="${esc(String(r.id))}">Удалить ответ</button>
      </div>`).join('') : '<p class="small muted">Ответов нет.</p>';
  }

  $('admin-posts').addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    try {
      if (e.target.closest('[data-replies]')) await showReplies(card);
      if (e.target.closest('[data-del-post]') && confirm('Удалить тему вместе со всеми ответами?')) {
        await DB.forum.remove(card.dataset.id);
        toast('Тема удалена');
        loadForum();
      }
      const delReply = e.target.closest('[data-del-reply]');
      if (delReply && confirm('Удалить ответ?')) {
        await DB.forum.removeReply(delReply.dataset.delReply);
        toast('Ответ удалён');
        showReplies(card);
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- сообщения ---------- */
  /*
   * Ответ пишется прямо в админке и открывается в Gmail в браузере
   * (с ящика сайта) — почтовая программа на компьютере не нужна.
   */

  let messages = [];
  const SUBJECT = 'ВкусЗдоровья: ответ на ваше сообщение';

  function gmailLink(m, text) {
    const quote = `\n\n— — —\n${m.name} писал(а) ${fmt(m.created_at)}:\n${m.message}`;
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: m.email, su: SUBJECT, body: (text || '') + quote });
    return 'https://mail.google.com/mail/?' + params.toString();
  }

  function loadMessages() {
    const box = $('messages');
    return guard(box, async () => {
      messages = await DB.admin.messages();
      box.innerHTML = messages.length ? messages.map((m) => `
        <article class="card post${m.answered_at ? ' answered' : ''}" data-id="${esc(String(m.id))}">
          <div class="post-meta">
            ${m.answered_at ? `<span class="badge">✓ Отвечено ${fmt(m.answered_at)}</span>` : '<span class="badge">Новое</span>'}
            <span>👤 ${esc(m.name)}</span>
            <span>${esc(m.email)}</span>
            <span>${fmt(m.created_at)}</span>
          </div>
          <div class="post-body">${esc(m.message)}</div>
          <div class="reply-box">
            <label class="sr-only" for="reply-${esc(String(m.id))}">Текст ответа</label>
            <textarea class="textarea" id="reply-${esc(String(m.id))}" data-reply-text placeholder="Текст ответа…" style="min-height:90px"></textarea>
          </div>
          <div class="post-foot">
            <button class="btn btn-primary btn-sm" type="button" data-gmail>✉️ Ответить через Gmail</button>
            <button class="btn btn-ghost btn-sm" type="button" data-copy>Скопировать адрес и текст</button>
            ${m.answered_at ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-answered>Отметить «Отвечено»</button>'}
            <button class="btn btn-danger btn-sm" type="button" data-del-msg>Удалить</button>
          </div>
        </article>`).join('') : '<div class="card muted center">Сообщений нет.</div>';
    });
  }

  async function markAnswered(id, silent) {
    try {
      await DB.admin.markAnswered(id);
      if (!silent) toast('Отмечено как отвеченное');
      loadMessages();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  $('messages').addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    const m = messages.find((x) => String(x.id) === card.dataset.id);
    const text = card.querySelector('[data-reply-text]').value.trim();

    if (e.target.closest('[data-gmail]')) {
      window.open(gmailLink(m, text), '_blank', 'noopener');
      if (!m.answered_at && confirm('Письмо открыто в Gmail. Отметить сообщение как отвеченное?')) markAnswered(m.id, true);
    }
    if (e.target.closest('[data-copy]')) {
      const full = `Кому: ${m.email}\nТема: ${SUBJECT}\n\n${text}`;
      try {
        await navigator.clipboard.writeText(full);
        toast('Адрес, тема и текст скопированы — вставьте в любую почту');
      } catch {
        toast(`Адрес: ${m.email}`);
      }
    }
    if (e.target.closest('[data-answered]')) markAnswered(m.id);
    if (e.target.closest('[data-del-msg]') && confirm('Удалить сообщение?')) {
      try {
        await DB.admin.deleteMessage(card.dataset.id);
        toast('Сообщение удалено');
        loadMessages();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  /* ---------- старт ---------- */

  userReady.then((user) => {
    me = user;
    if (!user) return showOnly('need-login');
    if (user.role !== 'admin') {
      $('demo-hint').classList.toggle('hidden', DB.mode !== 'demo');
      return showOnly('admin-login');
    }
    showOnly('panel');
    loadStats();
  });
})();
