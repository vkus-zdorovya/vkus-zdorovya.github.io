/* Поиск участников по нику. Блок <div data-user-search> превращается в поле с подсказками.
   data-mode="dm" — выбор открывает переписку, иначе — профиль. */
(function () {
  const { esc, avatarHtml, userReady } = window.UI;

  function mount(box) {
    const dm = box.dataset.mode === 'dm';
    const id = 'us-' + Math.random().toString(36).slice(2, 8);
    box.classList.add('user-search');
    box.innerHTML = `
      <label class="sr-only" for="${id}">Поиск участников</label>
      <input class="input" id="${id}" type="search" autocomplete="off" maxlength="40" placeholder="${esc(box.dataset.placeholder || '🔍 Найти участника')}">
      <div class="user-search-results" role="listbox" aria-label="Найденные участники"></div>`;
    const input = box.querySelector('input');
    const out = box.querySelector('.user-search-results');
    let timer = null;
    let seq = 0;
    let me = null;
    userReady.then((u) => { me = u; });

    const href = (u) => (dm ? `messages.html?to=${encodeURIComponent(u.id)}` : `profile.html?id=${encodeURIComponent(u.id)}`);

    async function search() {
      const q = input.value.trim();
      const n = ++seq;
      if (q.length < 2) {
        out.innerHTML = q ? '<p class="small muted">Введите хотя бы 2 буквы</p>' : '';
        return;
      }
      out.innerHTML = '<p class="small muted">Ищем…</p>';
      let list;
      try {
        list = await DB.searchUsers(q);
      } catch (error) {
        out.innerHTML = `<p class="small form-error">${esc(/search_profiles|schema cache|function/i.test(error.message)
          ? 'Поиск ещё не подключён: выполните в Supabase файл schema-7-search.sql' : error.message)}</p>`;
        return;
      }
      if (n !== seq) return;
      if (dm && me) list = list.filter((u) => u.id !== me.id);
      out.innerHTML = list.length ? list.map((u) => `
        <a class="user-result" role="option" href="${href(u)}">
          ${avatarHtml(u.name, u.avatar_url, 'avatar-md')}
          <span class="user-result-text">
            <b>${esc(u.name)}</b>
            <span class="small muted">${u.posts ? `тем на форуме: ${u.posts}` : 'участник'}${u.created_at ? ` · с ${esc(new Date(u.created_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }))}` : ''}</span>
          </span>
          <span class="user-result-go" aria-hidden="true">${dm ? '✉️' : '→'}</span>
        </a>`).join('') : '<p class="small muted">Никого не нашли</p>';
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; out.innerHTML = ''; }
      if (e.key === 'Enter') {
        const first = out.querySelector('.user-result');
        if (first) location.href = first.href;
      }
    });
  }

  document.querySelectorAll('[data-user-search]').forEach(mount);
})();
