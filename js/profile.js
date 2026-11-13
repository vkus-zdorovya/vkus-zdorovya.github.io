/* Публичный профиль участника: баннер, аватарка, ник и его темы на форуме */
(function () {
  const { esc, formatDate, avatarHtml, userReady } = window.UI;
  const id = new URLSearchParams(location.search).get('id');
  const box = document.getElementById('public-profile');

  async function load(me) {
    if (!id) {
      box.innerHTML = '<p class="muted">Профиль не найден.</p>';
      return;
    }
    try {
      const profiles = await DB.publicProfiles([id]);
      const p = profiles[id];
      if (!p) {
        box.innerHTML = '<p class="muted">Профиль не найден или удалён.</p>';
        return;
      }
      document.title = `${p.name} — ВкусЗдоровья`;
      box.innerHTML = `
        <div class="profile-banner">${p.banner_url ? `<img src="${esc(p.banner_url)}" alt="Баннер профиля">` : ''}</div>
        <div class="profile-row">
          ${avatarHtml(p.name, p.avatar_url, 'avatar-lg zoomable')}
          <div>
            <h1 style="font-size:1.8rem;margin-bottom:4px">${esc(p.name)}</h1>
            ${p.created_at ? `<div class="muted small">С нами с ${esc(new Date(p.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }))}</div>` : ''}
          </div>
          ${me && me.id === id
            ? '<a class="btn btn-ghost btn-sm" href="account.html">Редактировать</a>'
            : `<a class="btn btn-primary btn-sm" href="${me ? `messages.html?to=${encodeURIComponent(id)}` : 'login.html'}">✉️ Написать</a>`}
        </div>
        <div class="profile-badges" id="profile-badges"></div>
        ${me && me.id !== id ? `<div class="profile-tools">
          <button class="link-btn" type="button" id="block-btn"></button>
          <button class="link-btn danger" type="button" id="report-btn">🚩 Пожаловаться</button>
        </div>` : ''}`;

      // достижения: показываем только полученные
      DB.stats(id).then((st) => {
        const earned = window.BADGES.filter((b) => Number(st[b.key] || 0) >= b.goal);
        document.getElementById('profile-badges').innerHTML = earned.length
          ? `<div class="badges-inline">${earned.map((b) => `<span title="${esc(b.desc)}">${b.icon} ${esc(b.title)}</span>`).join('')}</div>` : '';
      }).catch(() => {});

      if (me && me.id !== id) {
        const blockBtn = document.getElementById('block-btn');
        let blocked = (await DB.blocks.list().catch(() => [])).includes(id);
        const paint = () => { blockBtn.textContent = blocked ? '✓ Вы заблокировали этого участника — разблокировать' : '🚫 Заблокировать'; };
        paint();
        blockBtn.addEventListener('click', async () => {
          if (!blocked && !confirm(`Заблокировать ${p.name}? Он не сможет писать вам в личные сообщения и добавлять в беседы.`)) return;
          try {
            await DB.blocks.set(id, !blocked);
            blocked = !blocked;
            paint();
            UI.toast(blocked ? 'Участник заблокирован' : 'Участник разблокирован');
          } catch (error) { UI.toast(error.message, 'error'); }
        });
        document.getElementById('report-btn').addEventListener('click', () => UI.reportDialog('profile', id));
      }

      const posts = await DB.forum.list(id);
      const list = document.getElementById('user-posts');
      document.getElementById('posts-title').classList.remove('hidden');
      list.innerHTML = posts.length ? posts.map((post) => `
        <article class="card post">
          <h3>${post.pinned ? '📌 ' : ''}${esc(post.title)}</h3>
          <div class="post-meta"><span class="badge">${esc(post.topic || 'Общее')}</span><span>${formatDate(post.created_at)}</span><span>💬 ${post.replies_count}</span></div>
          <div class="post-body clamped">${esc(post.body)}</div>
        </article>`).join('') : '<div class="card muted center">Пока нет тем на форуме.</div>';
    } catch (error) {
      box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    }
  }

  userReady.then(load);
})();
