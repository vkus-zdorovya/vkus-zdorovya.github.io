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

  const loaders = { overview: loadStats, users: loadUsers, avatars: loadAvatars, forum: loadForum, words: loadWords, messages: loadMessages };
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
        ['🖼 Фото и баннеры на проверке', s.avatars_pending || 0, ''],
        ['🔇 Замученных', s.muted || 0, ''],
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
        <tr><th>Имя</th><th>Почта</th><th>Роль</th><th>Мут</th><th>Регистрация</th><th>Последний вход</th><th></th></tr>
        ${list.map((u) => `
          <tr data-id="${esc(u.id)}">
            <td>${esc(u.name || '—')}</td>
            <td>${esc(u.email)} ${u.confirmed ? '' : '<span class="tag" title="Почта не подтверждена">не подтв.</span>'}</td>
            <td>${u.role === 'admin' ? '<span class="tag">админ</span>' : 'пользователь'}</td>
            <td>${isMuted(u)
              ? `<span class="tag" title="${esc(u.mute_reason || '')}">🔇 до ${esc(new Date(u.muted_until).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
                 <button class="link-btn" type="button" data-unmute>снять</button>`
              : u.id === me.id ? '—' : `<select class="select" data-mute-time style="min-height:34px;padding:2px 30px 2px 8px;width:auto">
                  <option value="">Замутить…</option>
                  <option value="1">на 1 час</option>
                  <option value="24">на сутки</option>
                  <option value="168">на неделю</option>
                  <option value="720">на месяц</option>
                  <option value="forever">навсегда</option>
                </select>`}</td>
            <td>${fmt(u.created_at)}</td>
            <td>${fmt(u.last_sign_in_at)}</td>
            <td>${u.id === me.id ? '' : `
              <button class="btn btn-ghost btn-sm" type="button" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-user>Удалить</button>`}</td>
          </tr>`).join('')}
      </table>` : '<p class="muted">Никого не найдено.</p>';
  }

  const isMuted = (u) => u.muted_until && new Date(u.muted_until) > new Date();

  function loadUsers() {
    return guard($('users'), async () => {
      users = await DB.admin.users();
      renderUsers();
    });
  }

  $('user-search').addEventListener('input', renderUsers);

  $('users').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-mute-time]');
    if (!sel || !sel.value) return;
    const u = users.find((x) => x.id === sel.closest('tr').dataset.id);
    const reason = prompt(`Причина мута для ${u.name || u.email} (её увидит пользователь):`, 'Нарушение правил форума');
    if (reason === null) {
      sel.value = '';
      return;
    }
    const until = sel.value === 'forever'
      ? new Date('2099-12-31T00:00:00Z').toISOString()
      : new Date(Date.now() + Number(sel.value) * 3600 * 1000).toISOString();
    try {
      await DB.admin.mute(u.id, until, reason.trim() || 'Нарушение правил форума');
      toast(`${u.name || u.email} замучен`);
      loadUsers();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('users').addEventListener('click', async (e) => {
    const row = e.target.closest('tr');
    if (!row) return;
    const u = users.find((x) => x.id === row.dataset.id);
    if (e.target.closest('[data-unmute]')) {
      try {
        await DB.admin.mute(u.id, null, null);
        toast('Мут снят');
        loadUsers();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
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

  /* ---------- проверка фото и баннеров ---------- */

  let media = [];
  function loadAvatars() {
    const box = $('avatar-requests');
    return guard(box, async () => {
      media = await DB.admin.mediaRequests();
      $('avatars-count').textContent = media.length ? `(${media.length})` : '';
      box.innerHTML = media.length ? media.map((r, i) => `
        <div class="card avatar-request${r.kind === 'banner' ? ' is-banner' : ''}" data-i="${i}">
          <div class="avatar-request-head">
            <span class="tag">${r.kind === 'banner' ? '🖼 Баннер профиля' : '👤 Фото профиля'}</span>
          </div>
          <div class="avatar-request-preview">
            ${r.kind === 'banner'
              ? `<img class="media-request-banner" src="${esc(r.pending_url)}" alt="Новый баннер">`
              : `<span class="avatar avatar-xl"><img src="${esc(r.pending_url)}" alt="Новое фото"></span>`}
          </div>
          <div class="avatar-request-user">
            <b>${esc(r.name || '—')}</b>
            <span class="small muted">${esc(r.email)}</span>
          </div>
          <div class="avatar-request-actions">
            <button class="btn btn-primary btn-sm" type="button" data-approve>✓ Одобрить</button>
            <button class="btn btn-danger btn-sm" type="button" data-reject>✕ Отклонить</button>
          </div>
        </div>`).join('') : '<div class="card muted center" style="grid-column:1/-1">Новых фото и баннеров нет.</div>';
    });
  }

  $('avatar-requests').addEventListener('click', async (e) => {
    const card = e.target.closest('.avatar-request');
    const approve = e.target.closest('[data-approve]');
    const reject = e.target.closest('[data-reject]');
    if (!card || (!approve && !reject)) return;
    const r = media[Number(card.dataset.i)];
    try {
      await DB.admin.reviewMedia(r.id, r.kind, Boolean(approve));
      toast(approve ? 'Одобрено' : 'Отклонено');
      loadAvatars();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- запрещённые слова ---------- */

  function loadWords() {
    const box = $('words');
    return guard(box, async () => {
      const words = await DB.admin.words();
      box.innerHTML = words.length
        ? words.map((w) => `<span class="chip">${esc(w)} <button class="link-btn" type="button" data-del-word="${esc(w)}" aria-label="Удалить ${esc(w)}">✕</button></span>`).join('')
        : '<p class="muted">Список пуст.</p>';
    });
  }

  $('word-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('word-input');
    const word = input.value.trim().toLowerCase().replace(/ё/g, 'е');
    if (!/^[а-яa-z0-9]{2,40}\*?$/.test(word)) {
      toast('Только буквы и цифры, от 2 до 40 символов, можно со * на конце', 'error');
      return;
    }
    try {
      await DB.admin.addWord(word);
      input.value = '';
      toast(`«${word}» добавлено`);
      loadWords();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('words').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-word]');
    if (!btn) return;
    try {
      await DB.admin.removeWord(btn.dataset.delWord);
      loadWords();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  /* ---------- форум ---------- */

  let forumPosts = [];
  function loadForum() {
    const box = $('admin-posts');
    return guard(box, async () => {
      forumPosts = await DB.forum.list();
      const posts = forumPosts;
      box.innerHTML = posts.length ? posts.map((p) => `
        <article class="card post" data-id="${esc(String(p.id))}">
          <h3>${p.pinned ? '📌 ' : ''}${esc(p.title)}</h3>
          <div class="post-meta"><span class="badge">${esc(p.topic || 'Общее')}</span><span>👤 ${esc(p.author_name)}</span><span>${fmt(p.created_at)}</span></div>
          <div class="post-body clamped">${esc(p.body)}</div>
          <div class="post-foot">
            <button class="btn btn-ghost btn-sm" type="button" data-replies>💬 Ответы (${p.replies_count})</button>
            <button class="btn btn-ghost btn-sm" type="button" data-pin>${p.pinned ? 'Открепить' : '📌 Закрепить'}</button>
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
    card.replyList = replies;
    box.innerHTML = replies.length ? replies.map((r) => `
      <div class="reply${r.pinned ? ' pinned' : ''}">
        <div class="post-meta">${r.pinned ? '<span class="badge">📌 Закреплён</span>' : ''}<span>👤 ${esc(r.author_name)}</span><span>${fmt(r.created_at)}</span></div>
        <div class="post-body">${esc(r.body)}</div>
        <div class="reply-actions">
          <button class="link-btn" type="button" data-pin-reply="${esc(String(r.id))}">${r.pinned ? 'Открепить' : '📌 Закрепить'}</button>
          <button class="link-btn danger" type="button" data-del-reply="${esc(String(r.id))}">Удалить ответ</button>
        </div>
      </div>`).join('') : '<p class="small muted">Ответов нет.</p>';
  }

  $('admin-posts').addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    try {
      if (e.target.closest('[data-replies]')) await showReplies(card);
      if (e.target.closest('[data-pin]')) {
        const post = forumPosts.find((p) => String(p.id) === card.dataset.id);
        await DB.admin.pinPost(post.id, !post.pinned);
        toast(post.pinned ? 'Тема откреплена' : 'Тема закреплена');
        loadForum();
      }
      if (e.target.closest('[data-del-post]') && confirm('Удалить тему вместе со всеми ответами?')) {
        await DB.forum.remove(card.dataset.id);
        toast('Тема удалена');
        loadForum();
      }
      const pinReply = e.target.closest('[data-pin-reply]');
      if (pinReply) {
        const r = (card.replyList || []).find((x) => String(x.id) === pinReply.dataset.pinReply);
        await DB.admin.pinReply(r.id, !r.pinned);
        toast(r.pinned ? 'Комментарий откреплён' : 'Комментарий закреплён');
        await showReplies(card);
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
   * Ответ уходит с общей почты сайта через функцию Supabase admin-reply.
   * Если функция ещё не подключена — письмо открывается в Gmail под общей почтой.
   */

  let messages = [];
  const SUBJECT = 'ВкусЗдоровья: ответ на ваше сообщение';
  const SITE_EMAIL = (window.APP_CONFIG && APP_CONFIG.SITE_EMAIL) || '';

  function gmailLink(m, text) {
    const quote = `\n\n— — —\n${m.name} писал(а) ${fmt(m.created_at)}:\n${m.message}`;
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: m.email, su: SUBJECT, body: (text || '') + quote });
    if (SITE_EMAIL) params.set('authuser', SITE_EMAIL); // письмо открывается в ящике сайта, а не в личном
    return 'https://mail.google.com/mail/?' + params.toString();
  }

  function loadMessages() {
    const box = $('messages');
    return guard(box, async () => {
      messages = await DB.admin.messages();
      box.innerHTML = messages.length ? messages.map((m) => `
        <article class="card post${m.answered_at ? ' answered' : ''}" data-id="${esc(String(m.id))}">
          <div class="post-meta">
            ${m.answered_at ? `<span class="badge">✓ Отвечено ${fmt(m.answered_at)}</span>` : '<span class="badge badge-new">Новое</span>'}
            <span>👤 ${esc(m.name)}</span>
            <span>${esc(m.email)}</span>
            <span>${fmt(m.created_at)}</span>
          </div>
          <div class="post-body">${esc(m.message)}</div>
          ${m.reply_text ? `<div class="reply sent-reply"><div class="post-meta"><span>↩️ Ваш ответ</span></div><div class="post-body">${esc(m.reply_text)}</div></div>` : ''}
          <div class="reply-box">
            <label class="sr-only" for="reply-${esc(String(m.id))}">Текст ответа</label>
            <textarea class="textarea" id="reply-${esc(String(m.id))}" data-reply-text placeholder="Текст ответа… Письмо уйдёт с ${esc(SITE_EMAIL || 'почты сайта')}" style="min-height:90px"></textarea>
          </div>
          <div class="post-foot">
            <button class="btn btn-primary btn-sm" type="button" data-send>✉️ Отправить ответ</button>
            <button class="btn btn-ghost btn-sm" type="button" data-gmail>Открыть в Gmail</button>
            <button class="btn btn-ghost btn-sm" type="button" data-copy>Скопировать</button>
            ${m.answered_at ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-answered>✓ Отметить «Отвечено»</button>'}
            <button class="btn btn-danger btn-sm" type="button" data-del-msg>Удалить</button>
          </div>
        </article>`).join('') : '<div class="card muted center">Сообщений нет.</div>';
    });
  }

  async function markAnswered(id, reply, silent) {
    try {
      await DB.admin.markAnswered(id, reply);
      if (!silent) toast('Отмечено как отвеченное');
      await loadMessages();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  $('messages').addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    const m = messages.find((x) => String(x.id) === card.dataset.id);
    if (!m) return;
    const text = card.querySelector('[data-reply-text]').value.trim();

    const sendBtn = e.target.closest('[data-send]');
    if (sendBtn) {
      if (!text) {
        toast('Напишите текст ответа', 'error');
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Отправляем…';
      try {
        await DB.admin.sendReply(m.id, text);
        toast(`Ответ отправлен на ${m.email}`);
        await loadMessages();
      } catch (error) {
        sendBtn.disabled = false;
        sendBtn.textContent = '✉️ Отправить ответ';
        if (error.noFunction) {
          toast('Отправка с сайта ещё не подключена — открываем Gmail с почтой сайта', 'error');
          window.open(gmailLink(m, text), '_blank', 'noopener');
          if (confirm('Когда отправите письмо в Gmail, отметить сообщение как отвеченное?')) markAnswered(m.id, text, true);
        } else {
          toast(error.message, 'error');
        }
      }
      return;
    }
    if (e.target.closest('[data-gmail]')) {
      window.open(gmailLink(m, text), '_blank', 'noopener');
      if (!m.answered_at && confirm('Письмо открыто в Gmail. Отметить сообщение как отвеченное?')) markAnswered(m.id, text, true);
    }
    if (e.target.closest('[data-copy]')) {
      const full = `Кому: ${m.email}\nТема: ${SUBJECT}\n\n${text}`;
      try {
        await navigator.clipboard.writeText(full);
        toast('Адрес, тема и текст скопированы');
      } catch {
        toast(`Адрес: ${m.email}`);
      }
    }
    const answeredBtn = e.target.closest('[data-answered]');
    if (answeredBtn) {
      answeredBtn.disabled = true;
      await markAnswered(m.id, text);
      answeredBtn.disabled = false;
    }
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
