/* Каталог рецептов с фильтрами и добавлением в рацион / дневник */
(function () {
  const { esc, toast } = window.UI;
  const { MEALS, DAYS, FOOD, getDraft, saveDraft, isoDate, weekdayIndex, diaryEntry } = window.PLAN;
  const recipes = window.RECIPES;
  const TAGS = window.RECIPE_TAGS;

  const list = document.getElementById('recipes');
  const search = document.getElementById('r-search');
  const mealBox = document.getElementById('r-meal');
  const tagBox = document.getElementById('r-tags');
  const modal = document.getElementById('recipe-modal');
  const detail = document.getElementById('recipe-detail');

  let meal = '';
  const activeTags = new Set();

  tagBox.innerHTML = Object.entries(TAGS).map(([key, label]) =>
    `<button type="button" class="chip" data-tag="${key}" aria-pressed="false">${label}</button>`).join('');

  function render() {
    const q = search.value.trim().toLowerCase();
    const found = recipes.filter((r) =>
      (!meal || r.meal === meal) &&
      [...activeTags].every((t) => r.tags.includes(t)) &&
      (!q || r.title.toLowerCase().includes(q) || r.items.some(([id]) => FOOD[id].name.toLowerCase().includes(q))));

    list.innerHTML = found.length ? found.map((r) => `
      <button type="button" class="recipe" data-id="${r.id}">
        <div class="recipe-art" aria-hidden="true"><img src="img/recipes/${r.id}.webp" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${r.emoji}'))"></div>
        <div class="recipe-info">
          <h3>${esc(r.title)}</h3>
          <div class="recipe-meta"><span>⏱ ${r.time} мин</span><span>🔥 ${r.total.kcal} ккал</span><span>${window.MEAL_NAMES[r.meal]}</span></div>
          <div class="tags">${r.tags.filter((t) => t !== 'quick').map((t) => `<span class="tag">${TAGS[t]}</span>`).join('')}</div>
        </div>
      </button>`).join('')
      : '<div class="card center muted" style="grid-column:1/-1">Ничего не нашлось — попробуйте снять фильтры.</div>';
  }

  function open(id) {
    const r = recipes.find((x) => x.id === id);
    if (!r) return;
    const draft = getDraft();
    const week = draft.mode === 'week';
    detail.innerHTML = `
      <div class="recipe-art" aria-hidden="true"><img src="img/recipes/${r.id}.webp" alt="" onerror="this.replaceWith(document.createTextNode('${r.emoji}'))"></div>
      <h2 id="rm-title">${esc(r.title)}</h2>
      <div class="recipe-meta"><span>⏱ ${r.time} мин</span><span>⚖️ порция ${r.portion} г</span><span>${window.MEAL_NAMES[r.meal]}</span></div>
      <div class="tags" style="margin-top:10px">${r.tags.map((t) => `<span class="tag">${TAGS[t]}</span>`).join('')}</div>
      <div class="nutri-row">
        <div class="stat"><div class="stat-label">Ккал</div><div class="stat-value">${r.total.kcal}</div></div>
        <div class="stat"><div class="stat-label">Белки</div><div class="stat-value">${r.total.p} г</div></div>
        <div class="stat"><div class="stat-label">Жиры</div><div class="stat-value">${r.total.f} г</div></div>
        <div class="stat"><div class="stat-label">Углеводы</div><div class="stat-value">${r.total.c} г</div></div>
      </div>
      <h3>Состав на порцию</h3>
      <ul class="ingredients">
        ${r.items.map(([id, g]) => `<li>${esc(FOOD[id].name)} — ${g} г</li>`).join('')}
        ${r.extra ? `<li class="muted">${esc(r.extra)}</li>` : ''}
      </ul>
      <h3>Приготовление</h3>
      <ol class="steps-list">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

      <h3>Добавить</h3>
      <div class="add-row">
        <div class="field">
          <label for="rm-meal">Приём пищи</label>
          <select class="select" id="rm-meal">${MEALS.map(([key, title]) => `<option value="${key}"${key === r.meal ? ' selected' : ''}>${title}</option>`).join('')}</select>
        </div>
        <div class="field${week ? '' : ' hidden'}">
          <label for="rm-day">День рациона</label>
          <select class="select" id="rm-day">${DAYS.map((d, i) => `<option value="${i}"${i === weekdayIndex() ? ' selected' : ''}>${d}</option>`).join('')}</select>
        </div>
      </div>
      <div class="add-row">
        <button class="btn btn-lime" type="button" data-to-plan="${r.id}">➕ В рацион</button>
        <button class="btn btn-primary" type="button" data-to-diary="${r.id}">📔 В дневник за сегодня</button>
      </div>`;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  }

  function close() {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  detail.addEventListener('click', async (e) => {
    const toPlan = e.target.closest('[data-to-plan]');
    const toDiary = e.target.closest('[data-to-diary]');
    if (!toPlan && !toDiary) return;
    const r = recipes.find((x) => x.id === (toPlan || toDiary).dataset[toPlan ? 'toPlan' : 'toDiary']);
    const mealKey = document.getElementById('rm-meal').value;
    const foodId = 'r_' + r.id;

    if (toPlan) {
      const draft = getDraft();
      const day = draft.mode === 'week' ? Number(document.getElementById('rm-day').value) : 0;
      draft.days[day][mealKey].push({ id: foodId, g: r.portion });
      saveDraft(draft);
      close();
      toast(`«${r.title}» добавлен в рацион`);
    } else {
      try {
        await DB.diary.add(diaryEntry(foodId, r.portion, mealKey, isoDate()));
        close();
        toast(`«${r.title}» записан в дневник`);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  list.addEventListener('click', (e) => {
    const card = e.target.closest('.recipe');
    if (card) open(card.dataset.id);
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
    const tag = chip.dataset.tag;
    activeTags.has(tag) ? activeTags.delete(tag) : activeTags.add(tag);
    chip.classList.toggle('active', activeTags.has(tag));
    chip.setAttribute('aria-pressed', String(activeTags.has(tag)));
    render();
  });

  render();
  const fromHash = location.hash.slice(1);
  if (fromHash) open(fromHash);
})();
