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
  const isLong = (text) => text.length > 600 || text.split('\n').length > 8;
  const canDelete = (item) => user && (user.id === item.author_id || user.role === 'admin');
  let user = null;
  const open = new Set();

  async function load() {
    try {
      posts = await DB.forum.list();
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
      <article class="card post" data-id="${p.id}">
        <h3>${esc(p.title)}</h3>
        <div class="post-meta">
          <span class="badge">${esc(p.topic || 'Общее')}</span>
          <span>👤 ${esc(p.author_name)}</span>
          <span>${formatDate(p.created_at)}</span>
        </div>
        <div class="post-body${isLong(p.body) ? ' clamped' : ''}">${esc(p.body)}</div>
        ${isLong(p.body) ? '<button class="link-btn" type="button" data-expand>Показать полностью</button>' : ''}
        <div class="post-foot">
          <button class="btn btn-ghost btn-sm" type="button" data-toggle>💬 Ответы (${p.replies_count})</button>
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
      box.innerHTML = replies.map((r) => `
        <div class="reply">
          <div class="post-meta"><span>👤 ${esc(r.author_name)}</span><span>${formatDate(r.created_at)}</span></div>
          <div class="post-body">${esc(r.body)}</div>
          ${canDelete(r) ? `<button class="link-btn" type="button" data-del-reply="${r.id}">Удалить ответ</button>` : ''}
        </div>`).join('') + (user
        ? `<form class="reply-form" novalidate>
             <label class="sr-only" for="reply-${card.dataset.id}">Ваш ответ</label>
             <input class="input" id="reply-${card.dataset.id}" name="body" maxlength="2000" placeholder="Ваш ответ…" required>
             <button class="btn btn-primary btn-sm" type="submit">Ответить</button>
           </form>`
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
    document.getElementById(u ? 'new-post' : 'new-post-auth').classList.remove('hidden');
    load();
  });
})();
