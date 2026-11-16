/* Каталог рецептов: фильтры, предпочтения, избранное, оценки, рецепты участников, добавление в рацион и дневник */
(function () {
  const { esc, toast, userReady } = window.UI;
  const { MEALS, DAYS, FOOD, getDraft, saveDraft, isoDate, weekdayIndex, diaryEntry } = window.PLAN;
  const TAGS = window.RECIPE_TAGS;
  const MEAL_EMOJI = { breakfast: '🥣', lunch: '🍲', dinner: '🍽', snack: '🍎' };
  const $ = (id) => document.getElementById(id);

  const list = $('recipes');
  const search = $('r-search');
  const mealBox = $('r-meal');
  const tagBox = $('r-tags');
  const modal = $('recipe-modal');
  const detail = $('recipe-detail');

  /* рецепты сайта и участников приводим к одному виду */
  const builtin = window.RECIPES.map((r) => ({
    ...r, key: r.id, kind: 'builtin', img: `img/recipes/${r.id}.webp`, link: `recipe-${r.id}.html`,
    ingredients: [...r.items.map(([id, g]) => `${FOOD[id].name} — ${g} г`), ...(r.extra ? [r.extra] : [])],
    words: [...r.items.map(([id]) => FOOD[id].name), r.extra || ''].join(' ').toLowerCase(),
  }));
  /* поиск без учёта регистра и «ё»; длинные слова ищем по основе: от 5 букв без последней (курица → куриц…),
     от 7 букв без двух последних (чечевица → чечеви…) */
  const stem = (w) => (w.length >= 7 ? w.slice(0, -2) : w.length >= 5 ? w.slice(0, -1) : w);
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
  const matchesQuery = (r, q) => {
    const text = norm(r.title + ' ' + r.words);
    return norm(q).split(/\s+/).filter(Boolean).every((w) => text.includes(w) || text.includes(stem(w)));
  };
  const lines = (text) => String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const fromUser = (r) => ({
    key: 'u' + r.id, kind: 'user', id: r.id, title: r.title, emoji: MEAL_EMOJI[r.meal] || '🍽', meal: r.meal, time: r.minutes,
    portion: Number(r.portion), total: { kcal: Math.round(r.kcal), p: Math.round(r.protein), f: Math.round(r.fat), c: Math.round(r.carbs) },
    tags: [...(r.tags || []), ...(r.minutes <= 15 ? ['quick'] : [])], img: r.photo_url || '', link: `recipes.html#u${r.id}`,
    ingredients: lines(r.ingredients), steps: lines(r.steps), words: String(r.ingredients || '').toLowerCase(),
    author: r.author_name || 'Участник', author_id: r.user_id, status: r.status, mine: Boolean(r.mine), raw: r,
  });

  let recipes = builtin;
  let me = null;
  let avoid = [];
  let showAll = false; // показывать и то, что не подходит предпочтениям
  let favOnly = false;
  let favs = new Set();
  let stats = {};
  let myRatings = {};
  let meal = '';
  const activeTags = new Set();

  tagBox.innerHTML = '<button type="button" class="chip" data-fav aria-pressed="false">♥ Избранное</button>' +
    Object.entries(TAGS).map(([key, label]) => `<button type="button" class="chip" data-tag="${key}" aria-pressed="false">${label}</button>`).join('');

  const conflicts = (r) => window.recipeConflicts(r.kind === 'builtin' ? r : { tags: r.tags }, avoid);
  const conflictText = (keys) => keys.map((k) => window.AVOID[k].short).join(', ');
  const art = (r, alt = '') => (r.img
    ? `<img src="${esc(r.img)}" alt="${esc(alt)}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${r.emoji}'))">` : r.emoji);
  const ratingHtml = (r) => {
    const s = stats[r.key];
    return s ? `<span class="rating" title="Оценок: ${s.votes}">★ ${String(s.rating).replace('.', ',')} <span class="muted">(${s.votes})</span></span>` : '';
  };

  function render() {
    const q = search.value.trim().toLowerCase();
    const matched = recipes.filter((r) =>
      (!meal || r.meal === meal) && (!favOnly || favs.has(r.key)) &&
      [...activeTags].every((t) => r.tags.includes(t)) &&
      (!q || matchesQuery(r, q)));
    const hidden = avoid.length && !showAll ? matched.filter((r) => conflicts(r).length) : [];
    const found = matched.filter((r) => !hidden.includes(r));
    const filtered = Boolean(q || meal || favOnly || activeTags.size);

    const note = $('r-prefs-note');
    note.classList.toggle('hidden', !avoid.length);
    if (avoid.length) {
      const names = avoid.map((k) => window.AVOID[k].label.toLowerCase()).join(', ');
      note.innerHTML = showAll
        ? `Показаны все рецепты. Те, что не подходят вашим предпочтениям (${esc(names)}), отмечены ⚠️. <button class="link-btn" type="button" id="r-toggle-all">Скрыть неподходящие</button>`
        : `Учитываем ваши предпочтения: ${esc(names)}. ${hidden.length ? `Скрыто рецептов: ${hidden.length}.` : 'Все рецепты ниже вам подходят.'} ${hidden.length ? '<button class="link-btn" type="button" id="r-toggle-all">Показать все</button>' : ''} <a href="account.html#prefs-card">Изменить</a>`;
    }

    list.innerHTML = found.length ? found.map((r) => {
      const bad = conflicts(r);
      return `
      <a class="recipe${bad.length ? ' recipe-bad' : ''}" href="${esc(r.link)}" data-key="${esc(r.key)}">
        <div class="recipe-art" aria-hidden="true">${art(r)}</div>
        <button class="fav-btn${favs.has(r.key) ? ' on' : ''}" type="button" data-fav-key="${esc(r.key)}" aria-pressed="${favs.has(r.key)}" aria-label="${favs.has(r.key) ? 'Убрать из избранного' : 'В избранное'}: ${esc(r.title)}">♥</button>
        <div class="recipe-info">
          <h3>${esc(r.title)}</h3>
          <div class="recipe-meta"><span>⏱ ${r.time} мин</span><span>🔥 ${r.total.kcal} ккал</span><span>${window.MEAL_NAMES[r.meal]}</span>${ratingHtml(r)}</div>
          <div class="tags">
            ${r.kind === 'user' ? `<span class="tag tag-user">👤 ${esc(r.author)}</span>` : ''}
            ${r.status === 'pending' ? '<span class="tag tag-wait">⏳ на проверке</span>' : r.status === 'rejected' ? '<span class="tag tag-bad">не прошёл проверку</span>' : ''}
            ${bad.length ? `<span class="tag tag-bad">⚠️ содержит ${esc(conflictText(bad))}</span>` : ''}
            ${r.tags.filter((t) => t !== 'quick').map((t) => `<span class="tag">${TAGS[t]}</span>`).join('')}
          </div>
        </div>
      </a>`;
    }).join('')
      : `<div class="card center muted" style="grid-column:1/-1">${favOnly && !favs.size ? 'В избранном пока пусто. Нажмите ♥ на карточке рецепта.' : 'Ничего не нашлось — попробуйте снять фильтры.'}${filtered ? ' <button class="link-btn" type="button" data-reset-filters>Сбросить фильтры</button>' : ''}</div>`;

    // счётчик найденных и сброс фильтров
    let count = $('r-count');
    if (!count) {
      count = document.createElement('p');
      count.id = 'r-count';
      count.className = 'small muted r-count';
      count.setAttribute('aria-live', 'polite');
      list.before(count);
    }
    count.innerHTML = `Найдено рецептов: ${found.length}${filtered ? ' · <button class="link-btn" type="button" data-reset-filters>Сбросить фильтры</button>' : ''}`;
  }

  function resetFilters() {
    search.value = '';
    meal = '';
    favOnly = false;
    activeTags.clear();
    mealBox.querySelectorAll('button[data-meal]').forEach((b) => {
      const on = b.dataset.meal === '';
      b.classList.toggle('active', on);
      if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
    });
    tagBox.querySelectorAll('.chip').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
    render();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset-filters]')) resetFilters();
  });

  function open(key) {
    const r = recipes.find((x) => x.key === key);
    if (!r) return;
    const draft = getDraft();
    const week = draft.mode === 'week';
    const bad = conflicts(r);
    const mine = myRatings[r.key] || 0;
    detail.innerHTML = `
      <div class="recipe-art" aria-hidden="true">${art(r)}</div>
      <h2 id="rm-title">${esc(r.title)}</h2>
      <div class="recipe-meta"><span>⏱ ${r.time} мин</span><span>⚖️ порция ${r.portion} г</span><span>${window.MEAL_NAMES[r.meal]}</span>${ratingHtml(r)}</div>
      <div class="tags" style="margin-top:10px">
        ${r.kind === 'user' ? `<a class="tag tag-user" href="profile.html?id=${encodeURIComponent(r.author_id)}">👤 рецепт участника ${esc(r.author)}</a>` : ''}
        ${r.tags.map((t) => `<span class="tag">${TAGS[t]}</span>`).join('')}
      </div>
      ${r.status === 'pending' ? '<p class="form-note" style="margin-top:12px">⏳ Рецепт ждёт проверки администратором. Пока его видите только вы.</p>' : ''}
      ${bad.length ? `<p class="form-note warn" style="margin-top:12px">⚠️ Не подходит вашим предпочтениям: содержит ${esc(conflictText(bad))}.</p>` : ''}
      ${r.kind === 'user' && avoid.some((k) => !['veg', 'vegan', 'gf', 'lf'].includes(k)) ? '<p class="small muted" style="margin-top:8px">Рецепты участников не проверяются на аллергены автоматически — прочитайте состав.</p>' : ''}
      <div class="nutri-row">
        <div class="stat"><div class="stat-label">Ккал</div><div class="stat-value">${r.total.kcal}</div></div>
        <div class="stat"><div class="stat-label">Белки</div><div class="stat-value">${r.total.p} г</div></div>
        <div class="stat"><div class="stat-label">Жиры</div><div class="stat-value">${r.total.f} г</div></div>
        <div class="stat"><div class="stat-label">Углеводы</div><div class="stat-value">${r.total.c} г</div></div>
      </div>
      <h3>Состав на порцию</h3>
      <ul class="ingredients">${r.ingredients.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>Приготовление</h3>
      <ol class="steps-list">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

      <div class="rate-row">
        <div class="stars" role="group" aria-label="Ваша оценка">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star${n <= mine ? ' on' : ''}" data-rate="${n}" aria-label="Оценить на ${n}" aria-pressed="${n === mine}">★</button>`).join('')}
          <span class="small muted">${mine ? 'ваша оценка' : 'оцените рецепт'}</span>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-fav-key="${esc(r.key)}">${favs.has(r.key) ? '♥ В избранном' : '♡ В избранное'}</button>
      </div>

      <h3>Добавить</h3>
      <div class="add-row">
        <div class="field">
          <label for="rm-meal">Приём пищи</label>
          <select class="select" id="rm-meal">${MEALS.map(([k, title]) => `<option value="${k}"${k === r.meal ? ' selected' : ''}>${title}</option>`).join('')}</select>
        </div>
        <div class="field${week && r.kind === 'builtin' ? '' : ' hidden'}">
          <label for="rm-day">День рациона</label>
          <select class="select" id="rm-day">${DAYS.map((d, i) => `<option value="${i}"${i === weekdayIndex() ? ' selected' : ''}>${d}</option>`).join('')}</select>
        </div>
      </div>
      <div class="add-row">
        ${r.kind === 'builtin' ? `<button class="btn btn-lime" type="button" data-to-plan="${esc(r.key)}">➕ В рацион</button>` : ''}
        <button class="btn btn-primary" type="button" data-to-diary="${esc(r.key)}">📔 В дневник за сегодня</button>
      </div>
      ${r.mine ? `<button class="link-btn danger" type="button" data-del-recipe="${esc(String(r.id))}" style="margin-top:14px">Удалить мой рецепт</button>` : ''}`;
    if (!modal.open) {
      if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
    }
    detail.dataset.key = r.key;
  }

  function close() {
    if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  }
  // после закрытия окна (в том числе по Esc) убираем #рецепт из адреса, чтобы окно не открывалось при перезагрузке
  modal.addEventListener('close', () => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  });
  window.addEventListener('hashchange', () => {
    const key = decodeURIComponent(location.hash.slice(1));
    if (key) open(key);
  });

  async function toggleFav(key) {
    const on = !favs.has(key);
    try {
      await DB.recipes.setFavorite(key, on);
      if (on) favs.add(key); else favs.delete(key);
      render();
      if (modal.open && detail.dataset.key === key) open(key);
    } catch (error) { toast(error.message, 'error'); }
  }

  detail.addEventListener('click', async (e) => {
    const key = detail.dataset.key;
    const r = recipes.find((x) => x.key === key);
    if (!r) return;
    const fav = e.target.closest('[data-fav-key]');
    if (fav) return toggleFav(key);
    const star = e.target.closest('[data-rate]');
    if (star) {
      try {
        await DB.recipes.rate(key, Number(star.dataset.rate));
        myRatings[key] = Number(star.dataset.rate);
        stats = await DB.recipes.stats();
        open(key);
        render();
        toast('Спасибо за оценку!');
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const del = e.target.closest('[data-del-recipe]');
    if (del) {
      if (!confirm('Удалить рецепт? Это нельзя отменить.')) return;
      try {
        await DB.recipes.remove(r.id);
        recipes = recipes.filter((x) => x.key !== key);
        close();
        render();
        toast('Рецепт удалён');
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const toPlan = e.target.closest('[data-to-plan]');
    const toDiary = e.target.closest('[data-to-diary]');
    if (!toPlan && !toDiary) return;
    const mealKey = $('rm-meal').value;
    if (toPlan) {
      const draft = getDraft();
      const day = draft.mode === 'week' ? Number($('rm-day').value) : 0;
      draft.days[day][mealKey].push({ id: 'r_' + r.id, g: r.portion });
      saveDraft(draft);
      close();
      toast(`«${r.title}» добавлен в рацион`);
    } else {
      try {
        await DB.diary.add(r.kind === 'builtin'
          ? diaryEntry('r_' + r.id, r.portion, mealKey, isoDate())
          : { date: isoDate(), meal: mealKey, name: r.title, grams: r.portion, kcal: r.total.kcal, protein: r.total.p, fat: r.total.f, carbs: r.total.c });
        close();
        toast(`«${r.title}» записан в дневник`);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  list.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav-key]');
    if (fav) {
      e.preventDefault();
      toggleFav(fav.dataset.favKey);
      return;
    }
    const card = e.target.closest('.recipe');
    // ссылка ведёт на отдельную страницу рецепта (её видят поисковики), а на сайте открываем окно
    if (card && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      open(card.dataset.key);
    }
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) close();
  });
  search.addEventListener('input', render);
  mealBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-meal]');
    if (!btn) return;
    meal = btn.dataset.meal;
    mealBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
  tagBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    let on;
    if ('fav' in chip.dataset) {
      favOnly = !favOnly;
      on = favOnly;
    } else {
      const tag = chip.dataset.tag;
      if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
      on = activeTags.has(tag);
    }
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
    render();
  });
  $('r-prefs-note').addEventListener('click', (e) => {
    if (e.target.closest('#r-toggle-all')) { showAll = !showAll; render(); }
  });

  /* ---------- предложить рецепт ---------- */

  const formModal = $('recipe-form-modal');
  const form = $('recipe-form');
  let photo = null;

  $('r-add').addEventListener('click', () => {
    if (!me) {
      toast('Войдите в аккаунт, чтобы предложить рецепт', 'error');
      setTimeout(() => { location.href = 'login.html'; }, 900);
      return;
    }
    form.querySelector('.form-error').textContent = '';
    delete form.dataset.confirmed;
    if (typeof formModal.showModal === 'function') formModal.showModal(); else formModal.setAttribute('open', '');
  });
  formModal.addEventListener('click', (e) => {
    if (e.target === formModal || e.target.closest('[data-close]')) formModal.close();
  });
  form.addEventListener('input', (e) => { if (/^rf-(kcal|p|f|c)$/.test(e.target.id)) delete form.dataset.confirmed; });

  /* фото уменьшаем до 1000 px */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => reject(new Error('Не удалось открыть фото'));
      img.src = URL.createObjectURL(file);
    });
  }
  $('rf-photo').addEventListener('change', async () => {
    const file = $('rf-photo').files[0];
    if (!file) return;
    try {
      photo = await shrink(file);
      $('rf-photo-name').textContent = '✓ ' + file.name;
    } catch (error) { photo = null; toast(error.message, 'error'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const n = (id) => Number(String($(id).value).replace(',', '.'));
    const fields = {
      title: $('rf-name').value.trim(), meal: $('rf-meal').value, minutes: Math.round(n('rf-min')), portion: n('rf-portion'),
      kcal: n('rf-kcal'), protein: n('rf-p'), fat: n('rf-f'), carbs: n('rf-c'),
      ingredients: $('rf-ingr').value.trim(), steps: $('rf-steps').value.trim(),
      tags: [...form.querySelectorAll('[name="rf-tag"]:checked')].map((i) => i.value),
    };
    const empty = ['rf-min', 'rf-portion', 'rf-kcal', 'rf-p', 'rf-f', 'rf-c'].some((id) => $(id).value.trim() === '');
    if (fields.title.length < 3) { err.textContent = 'Название — минимум 3 буквы'; return; }
    if (empty || !(fields.minutes >= 1 && fields.minutes <= 600) || !(fields.portion >= 10 && fields.portion <= 3000)) { err.textContent = 'Заполните время, вес порции и КБЖУ'; return; }
    if (!(fields.kcal >= 0 && fields.kcal <= 5000) || [fields.protein, fields.fat, fields.carbs].some((v) => !(v >= 0 && v <= 500))) { err.textContent = 'Проверьте КБЖУ порции'; return; }
    if (fields.protein + fields.fat + fields.carbs > fields.portion) { err.textContent = 'Белков, жиров и углеводов вместе не может быть больше веса порции'; return; }
    if (fields.ingredients.length < 5 || fields.steps.length < 10) { err.textContent = 'Опишите ингредиенты и шаги приготовления'; return; }
    if (fields.tags.includes('vegan') && !fields.tags.includes('veg')) fields.tags.push('veg');
    const est = 4 * fields.protein + 9 * fields.fat + 4 * fields.carbs;
    if (Math.abs(fields.kcal - est) > Math.max(40, est * 0.2) && !form.dataset.confirmed) {
      err.innerHTML = `⚠️ Калории не сходятся с БЖУ: по расчёту выходит около <b>${Math.round(est)} ккал</b>, а указано <b>${fields.kcal}</b>. Проверьте цифры. Если всё верно, нажмите «Отправить» ещё раз.`;
      form.dataset.confirmed = '1';
      return;
    }
    if (!(await DB.checkText([fields.title, fields.ingredients, fields.steps].join(' ')))) { err.textContent = 'Текст содержит недопустимые слова'; return; }
    err.textContent = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await DB.recipes.submit(fields, photo);
      formModal.close();
      form.reset();
      photo = null;
      $('rf-photo-name').textContent = 'по желанию';
      toast(res && res.status === 'approved' ? 'Рецепт опубликован' : 'Рецепт отправлен на проверку. Мы сообщим, когда его опубликуют');
      await loadUserRecipes();
      render();
    } catch (error) {
      err.textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- загрузка ---------- */

  async function loadUserRecipes() {
    let rows = [];
    try { rows = await DB.recipes.listUser(); } catch { rows = []; }
    recipes = [...builtin, ...rows.map(fromUser)];
  }

  render();
  userReady.then(async (user) => {
    me = user;
    avoid = DB.prefs.clean(user ? user.prefs : DB.store.get('prefs')).avoid;
    render();
    const [, favList, st, mine] = await Promise.all([
      loadUserRecipes(),
      DB.recipes.favorites().catch(() => []),
      DB.recipes.stats().catch(() => ({})),
      DB.recipes.myRatings().catch(() => ({})),
    ]);
    favs = new Set(favList);
    stats = st;
    myRatings = mine;
    render();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) open(fromHash);
  });
})();
