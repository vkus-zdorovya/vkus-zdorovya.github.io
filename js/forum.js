/* Форум: список тем, поиск, создание тем и ответы */
(function () {
  const { esc, toast, formatDate, userReady } = window.UI;
  const TOPICS = ['Общее', 'Рецепты', 'Вопросы', 'Похудение', 'Набор массы', 'Мотивация'];

  const postsEl = document.getElementById('posts');
  const search = document.getElementById('search');
  const filter = document.getElementById('topic-filter');
  const form = document.getElementById('new-post');

  filter.insertAdjacentHTML('beforeend', TOPICS.map((t) => `<option>${t}</option>`).join(''));
  form.topic.innerHTML = TOPICS.map((t) => `<option>${t}</option>`).join('');

  let posts = [];
  const authors = {};
  /* автор: актуальный ник и одобренная аватарка, если есть */
  function author(item) {
    const info = authors[item.author_id] || {};
    const name = info.name || item.author_name;
    const href = `profile.html?id=${encodeURIComponent(item.author_id)}`;
    return `<div class="author-line">
      <a class="author-avatar" href="${href}" aria-hidden="true" tabindex="-1">${UI.avatarHtml(name, info.avatar_url, 'avatar-md zoomable')}</a>
      <div class="author-text">
        <a class="author-name" href="${href}">${esc(name)}</a>
        <time class="author-date" datetime="${esc(item.created_at)}">${formatDate(item.created_at)}</time>
      </div>
    </div>`;
  }
  const isAdmin = () => user && user.role === 'admin';
  const isMuted = () => user && user.muted_until && new Date(user.muted_until) > new Date();
  const BAD_WORDS = 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  const isLong = (text) => text.length > 600 || text.split('\n').length > 8;
  const canDelete = (item) => user && (user.id === item.author_id || user.role === 'admin');
  let user = null;
  const open = new Set();

  async function load() {
    try {
      posts = await DB.forum.list();
      Object.assign(authors, await DB.publicProfiles(posts.map((p) => p.author_id)));
      render();
    } catch (err) {
      postsEl.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const topic = filter.value;
    const list = posts.filter((p) =>
      (!topic || p.topic === topic) &&
      (!q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)));

    if (!list.length) {
      postsEl.innerHTML = '<div class="card center muted">Тем не найдено. Создайте первую!</div>';
      return;
    }
    postsEl.innerHTML = list.map((p) => `
      <article class="card post${p.pinned ? ' pinned' : ''}" data-id="${p.id}">
        <div class="post-head">
          ${author(p)}
          <div class="post-tags">${p.pinned ? '<span class="badge badge-pin">📌 Закреплено</span>' : ''}<span class="badge">${esc(p.topic || 'Общее')}</span></div>
        </div>
        <h3>${esc(p.title)}</h3>
        <div class="post-body${isLong(p.body) ? ' clamped' : ''}">${esc(p.body)}</div>
        ${isLong(p.body) ? '<button class="link-btn" type="button" data-expand>Показать полностью</button>' : ''}
        <div class="post-foot">
          <button class="btn btn-ghost btn-sm" type="button" data-toggle>💬 Ответы (${p.replies_count})</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-sm" type="button" data-pin>${p.pinned ? 'Открепить' : '📌 Закрепить'}</button>` : ''}
          ${canDelete(p) ? '<button class="btn btn-danger btn-sm" type="button" data-delete>Удалить</button>' : ''}
        </div>
        <div class="replies hidden"></div>
      </article>`).join('');
    open.forEach((id) => {
      const card = postsEl.querySelector(`.post[data-id="${CSS.escape(String(id))}"]`);
      if (card) loadReplies(card);
    });
  }

  async function loadReplies(card) {
    const box = card.querySelector('.replies');
    box.classList.remove('hidden');
    box.innerHTML = '<p class="muted small">Загрузка…</p>';
    try {
      const replies = await DB.forum.replies(card.dataset.id);
      Object.assign(authors, await DB.publicProfiles(replies.map((r) => r.author_id)));
      card.replyList = replies;
      box.innerHTML = replies.map((r) => `
        <div class="reply${r.pinned ? ' pinned' : ''}">
          <div class="post-head">${author(r)}${r.pinned ? '<div class="post-tags"><span class="badge badge-pin">📌 Закреплён</span></div>' : ''}</div>
          <div class="post-body">${esc(r.body)}</div>
          <div class="reply-actions">
            ${isAdmin() ? `<button class="link-btn" type="button" data-pin-reply="${r.id}">${r.pinned ? 'Открепить' : '📌 Закрепить'}</button>` : ''}
            ${canDelete(r) ? `<button class="link-btn danger" type="button" data-del-reply="${r.id}">Удалить ответ</button>` : ''}
          </div>
        </div>`).join('') + (user && !isMuted()
        ? `<form class="reply-form" novalidate>
             <label class="sr-only" for="reply-${card.dataset.id}">Ваш ответ</label>
             <input class="input" id="reply-${card.dataset.id}" name="body" maxlength="2000" placeholder="Ваш ответ…" required>
             <button class="btn btn-primary btn-sm" type="submit">Ответить</button>
           </form>`
        : user
          ? '<p class="small muted">Вы временно не можете отвечать.</p>'
          : '<p class="small muted"><a href="login.html">Войдите</a>, чтобы ответить.</p>');
    } catch (err) {
      box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  postsEl.addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    if (e.target.closest('[data-toggle]')) {
      const id = card.dataset.id;
      if (open.has(id)) {
        open.delete(id);
        card.querySelector('.replies').classList.add('hidden');
      } else {
        open.add(id);
        loadReplies(card);
      }
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const body = card.querySelector('.post-body');
      body.classList.toggle('clamped');
      expand.textContent = body.classList.contains('clamped') ? 'Показать полностью' : 'Свернуть';
    }
    const pinReply = e.target.closest('[data-pin-reply]');
    if (pinReply) {
      const r = (card.replyList || []).find((x) => String(x.id) === pinReply.dataset.pinReply);
      try {
        await DB.admin.pinReply(r.id, !r.pinned);
        toast(r.pinned ? 'Комментарий откреплён' : 'Комментарий закреплён');
        loadReplies(card);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    const delReply = e.target.closest('[data-del-reply]');
    if (delReply && confirm('Удалить этот ответ?')) {
      try {
        await DB.forum.removeReply(delReply.dataset.delReply);
        toast('Ответ удалён');
        open.add(card.dataset.id);
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (e.target.closest('[data-pin]')) {
      const post = posts.find((p) => String(p.id) === card.dataset.id);
      try {
        await DB.admin.pinPost(post.id, !post.pinned);
        toast(post.pinned ? 'Тема откреплена' : 'Тема закреплена');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (e.target.closest('[data-delete]') && confirm('Удалить тему вместе с ответами?')) {
      try {
        await DB.forum.remove(card.dataset.id);
        toast('Тема удалена');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  postsEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const replyForm = e.target;
    const body = replyForm.body.value.trim();
    if (!body) return;
    const card = replyForm.closest('.post');
    if (!(await DB.checkText(body))) {
      toast(BAD_WORDS, 'error');
      return;
    }
    replyForm.querySelector('button').disabled = true;
    try {
      await DB.forum.reply(card.dataset.id, body);
      open.add(card.dataset.id);
      await load();
    } catch (err) {
      toast(err.message, 'error');
      replyForm.querySelector('button').disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const title = form.title.value.trim();
    const body = form.body.value.trim();
    if (title.length < 3 || !body) {
      err.textContent = 'Заголовок — минимум 3 символа, сообщение не должно быть пустым';
      return;
    }
    if (!(await DB.checkText(title + ' ' + body))) {
      err.textContent = BAD_WORDS;
      return;
    }
    err.textContent = '';
    form.querySelector('button').disabled = true;
    try {
      await DB.forum.create({ title, body, topic: form.topic.value });
      form.reset();
      toast('Тема опубликована');
      await load();
    } catch (error) {
      err.textContent = error.message;
    } finally {
      form.querySelector('button').disabled = false;
    }
  });

  search.addEventListener('input', render);
  filter.addEventListener('change', render);

  userReady.then((u) => {
    user = u;
    if (isMuted()) {
      const note = document.getElementById('new-post-auth');
      note.innerHTML = `<p class="form-note warn">🔇 Вы не можете писать на форуме до ${esc(new Date(u.muted_until).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}${u.mute_reason ? `. Причина: ${esc(u.mute_reason)}` : ''}.</p>`;
      note.classList.remove('hidden');
    } else {
      document.getElementById(u ? 'new-post' : 'new-post-auth').classList.remove('hidden');
    }
    load();
  });
})();
