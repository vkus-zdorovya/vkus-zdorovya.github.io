/* Челленджи: участие, ежедневная отметка, таблица лидеров */
(function () {
  const { esc, toast, avatarHtml, userReady } = window.UI;
  const box = document.getElementById('challenges');
  let me = null;
  let list = [];
  const boards = {}; // id → строки таблицы лидеров (если раскрыта)
  const realId = (v) => (/^\d+$/.test(v) ? Number(v) : v);
  const days = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'}`;

  async function load() {
    try {
      list = await DB.challenges.list();
    } catch (error) {
      box.innerHTML = `<div class="card form-note">${esc(error.message)}</div>`;
      return;
    }
    render();
  }

  function render() {
    box.innerHTML = list.length ? list.map((c) => {
      const finished = c.done >= c.days;
      const board = boards[c.id];
      return `
      <article class="card challenge${c.joined ? ' joined' : ''}${finished ? ' finished' : ''}" data-id="${esc(String(c.id))}">
        <div class="challenge-head">
          <span class="challenge-emoji" aria-hidden="true">${esc(c.emoji)}</span>
          <div style="min-width:0">
            <h2>${esc(c.title)}</h2>
            <p class="muted">${esc(c.description || '')}</p>
            <div class="recipe-meta"><span>📅 ${days(c.days)}</span><span>👥 участников: ${c.members}</span></div>
          </div>
        </div>
        ${c.joined ? `
          <div class="goal-progress" role="img" aria-label="Выполнено ${c.done} из ${c.days} дней">
            <div class="goal-track"><i style="width:${Math.min(100, (c.done / c.days) * 100)}%"></i></div>
            <div class="goal-ends small muted"><span>${finished ? '🏆 Челлендж пройден!' : `выполнено ${c.done} из ${c.days}`}</span></div>
          </div>` : ''}
        <div class="post-foot">
          ${!c.joined ? '<button class="btn btn-primary btn-sm" type="button" data-join>Присоединиться</button>'
            : finished ? '<span class="tag">✓ Достижение получено</span>'
              : c.checked_today ? '<button class="btn btn-ghost btn-sm" type="button" disabled>✓ Сегодня отмечено</button>'
                : '<button class="btn btn-primary btn-sm" type="button" data-checkin>✅ Сегодня выполнил</button>'}
          <button class="btn btn-ghost btn-sm" type="button" data-board aria-expanded="${Boolean(board)}">🏆 Таблица лидеров</button>
          ${c.joined ? '<button class="link-btn report-link" type="button" data-leave>Выйти из челленджа</button>' : ''}
        </div>
        ${board ? `<ol class="board">${board.length ? board.map((u, i) => `
          <li class="${me && u.user_id === me.id ? 'me' : ''}">
            <span class="board-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
            <a class="post-author" href="profile.html?id=${encodeURIComponent(u.user_id)}">${avatarHtml(u.name, u.avatar_url, 'avatar-sm')}${esc(u.name)}</a>
            <span class="board-score">${u.finished ? '🏆 ' : ''}${u.done} / ${c.days}</span>
          </li>`).join('') : '<li class="muted">Пока никто не участвует — станьте первым.</li>'}</ol>` : ''}
      </article>`;
    }).join('') : '<div class="card muted center">Челленджей пока нет. Загляните позже.</div>';
  }

  box.addEventListener('click', async (e) => {
    const card = e.target.closest('.challenge');
    if (!card) return;
    const id = realId(card.dataset.id);
    const c = list.find((x) => String(x.id) === card.dataset.id);
    try {
      if (e.target.closest('[data-board]')) {
        if (boards[id]) delete boards[id]; else boards[id] = await DB.challenges.board(id);
        render();
        return;
      }
      if (!me && (e.target.closest('[data-join]') || e.target.closest('[data-checkin]'))) {
        toast('Войдите в аккаунт, чтобы участвовать', 'error');
        setTimeout(() => { location.href = 'login.html'; }, 900);
        return;
      }
      if (e.target.closest('[data-join]')) {
        await DB.challenges.join(id);
        toast(`Вы в челлендже «${c.title}». Возвращайтесь каждый день!`);
      } else if (e.target.closest('[data-checkin]')) {
        const done = await DB.challenges.checkin(id);
        toast(done >= c.days ? '🏆 Челлендж пройден! Достижение появится в профиле' : `Отлично! День ${done} из ${c.days}`);
      } else if (e.target.closest('[data-leave]')) {
        if (!confirm('Выйти из челленджа? Ваши отметки в нём удалятся.')) return;
        await DB.challenges.leave(id);
      } else {
        return;
      }
      if (boards[id]) boards[id] = await DB.challenges.board(id);
      await load();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  userReady.then((user) => { me = user; load(); });
})();
