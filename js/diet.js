/* Конструктор рациона на день или неделю */
(function () {
  const { esc, toast, formatDate, userReady } = window.UI;
  const store = DB.store;

  const { MEALS, DAYS, FOOD, emptyDay, newDraft: newState } = window.PLAN;
  const DAY_NAMES = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

  let state = store.get('diet_draft') || newState();
  /* что исключить при автоподборе: предпочтения из Кабинета */
  let avoid = DB.prefs.clean(store.get('prefs')).avoid;
  const fromCalc = store.get('target');
  if (fromCalc && fromCalc.kcal && document.referrer.includes('calculator')) {
    state.target = fromCalc.kcal;
    state.goal = fromCalc.goal;
  }

  const els = {
    target: document.getElementById('target'),
    goal: document.getElementById('goal'),
    mode: document.getElementById('mode'),
    tabs: document.getElementById('day-tabs'),
    meals: document.getElementById('meals'),
    copy: document.getElementById('copy-btn'),
  };

  const currentDay = () => state.days[state.mode === 'week' ? state.day : 0];

  function totals(day) {
    const sum = { kcal: 0, p: 0, f: 0, c: 0 };
    for (const [key] of MEALS) {
      for (const item of day[key]) {
        const food = FOOD[item.id];
        if (!food) continue;
        const k = item.g / 100;
        sum.kcal += food.kcal * k;
        sum.p += food.p * k;
        sum.f += food.f * k;
        sum.c += food.c * k;
      }
    }
    return sum;
  }

  const itemKcal = (item) => Math.round((FOOD[item.id] ? FOOD[item.id].kcal : 0) * item.g / 100);

  function save() {
    PLAN.saveDraft(state);
  }

  /* ---------- отрисовка ---------- */

  const foodOptions = (() => {
    const groups = {};
    window.FOODS.forEach((f) => { (groups[f.cat] = groups[f.cat] || []).push(f); });
    return '<option value="" disabled selected>Выберите продукт</option>' + Object.entries(groups).map(([cat, list]) =>
      `<optgroup label="${esc(cat)}">${list.map((f) => `<option value="${f.id}">${esc(f.name)} — ${f.kcal} ккал/100 г</option>`).join('')}</optgroup>`
    ).join('');
  })();

  function render() {
    els.target.value = state.target;
    els.goal.value = state.goal;
    els.mode.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    const week = state.mode === 'week';
    els.tabs.classList.toggle('hidden', !week);
    els.copy.classList.toggle('hidden', !week);
    document.getElementById('week-box').classList.toggle('hidden', !week);
    document.getElementById('auto-btn').textContent = week ? '✨ Заполнить всю неделю' : '✨ Подобрать автоматически';

    if (week) {
      els.tabs.innerHTML = DAYS.map((d, i) =>
        `<button type="button" role="tab" data-day="${i}" aria-selected="${i === state.day}" class="${i === state.day ? 'active' : ''}">${d}</button>`).join('');
    }

    const day = currentDay();
    els.meals.innerHTML = MEALS.map(([key, title, share]) => {
      const items = day[key];
      const mealKcal = items.reduce((s, it) => s + itemKcal(it), 0);
      const list = items.length
        ? `<ul class="meal-items">${items.map((it, i) => `
            <li class="meal-item">
              <span class="name">${esc(FOOD[it.id] ? FOOD[it.id].name : it.id)}</span>
              <input class="input" type="number" min="1" max="2000" step="5" value="${it.g}" data-meal="${key}" data-i="${i}" aria-label="Граммы">
              <span class="kcal">${itemKcal(it)} ккал</span>
              <button class="icon-btn" type="button" data-remove="${key}" data-i="${i}" aria-label="Удалить">✕</button>
            </li>`).join('')}</ul>`
        : '<p class="meal-empty">Пока пусто — добавьте продукты</p>';
      return `
        <section class="card meal">
          <div class="meal-head">
            <h3>${title}</h3>
            <span class="meal-kcal">${mealKcal} / ~${Math.round(state.target * share)} ккал</span>
          </div>
          ${list}
          <form class="meal-add" data-meal="${key}">
            <select class="select" name="food" aria-label="Продукт для: ${title}">${foodOptions}</select>
            <input class="input" name="grams" type="number" min="1" max="2000" step="5" placeholder="г" aria-label="Граммы">
            <button class="btn btn-lime" type="submit">Добавить</button>
          </form>
        </section>`;
    }).join('');

    renderSummary();
    save();
  }

  function renderSummary() {
    const week = state.mode === 'week';
    const sum = totals(currentDay());
    document.getElementById('sum-title').textContent = week ? `Итог за ${DAY_NAMES[state.day]}` : 'Итог за день';
    document.getElementById('sum-kcal').textContent = Math.round(sum.kcal).toLocaleString('ru-RU');
    document.getElementById('sum-target').textContent = state.target.toLocaleString('ru-RU');

    const ratio = sum.kcal / state.target;
    const bar = document.getElementById('sum-progress');
    bar.firstElementChild.style.width = Math.min(100, ratio * 100) + '%';
    bar.classList.toggle('over', ratio > 1.1);
    const diff = Math.round(state.target - sum.kcal);
    document.getElementById('sum-hint').textContent =
      sum.kcal === 0 ? 'Добавьте продукты или нажмите «Подобрать автоматически».'
        : Math.abs(diff) <= state.target * 0.05 ? '👍 Отлично, рацион соответствует норме.'
          : diff > 0 ? `Можно добавить ещё ~${diff} ккал.` : `Превышение нормы на ${-diff} ккал.`;

    const kp = sum.p * 4, kf = sum.f * 9, kc = sum.c * 4;
    const all = kp + kf + kc || 1;
    const a = (kp / all) * 100, b = a + (kf / all) * 100;
    document.getElementById('donut').style.background = sum.kcal
      ? `conic-gradient(#3c8a3f 0 ${a}%, #e8c33c ${a}% ${b}%, #6aa9e9 ${b}% 100%)`
      : 'conic-gradient(var(--field) 0 100%)';
    document.getElementById('legend').innerHTML = [
      ['#3c8a3f', 'Белки', sum.p, kp],
      ['#e8c33c', 'Жиры', sum.f, kf],
      ['#6aa9e9', 'Углеводы', sum.c, kc],
    ].map(([color, name, g, k]) => `<li><i style="background:${color}"></i>${name}: <b>${Math.round(g)} г</b> <span class="muted">(${Math.round((k / all) * 100)}%)</span></li>`).join('');

    if (week) {
      const kcals = state.days.map((d) => totals(d).kcal);
      const max = Math.max(state.target * 1.25, ...kcals);
      document.getElementById('week-chart').innerHTML =
        `<div class="target-line" style="bottom:${22 + (state.target / max) * 130}px" title="Норма"></div>` +
        kcals.map((k, i) => `
          <div class="week-col${i === state.day ? ' active' : ''}" data-day="${i}" title="${DAYS[i]}: ${Math.round(k)} ккал">
            <div style="height:${(k / max) * 130}px"></div><span>${DAYS[i]}</span>
          </div>`).join('');
    }
  }

  /* ---------- автоподбор ---------- */

  /* случайный шаблон, но не тот же, что вчера */
  function pick(count, avoid) {
    let idx;
    do idx = Math.floor(Math.random() * count); while (idx === avoid && count > 1);
    return idx;
  }

  function autoFill(dayIndex, prev = {}) {
    const day = emptyDay();
    const used = {};
    for (const [key, , share] of MEALS) {
      // учитываем предпочтения из Кабинета: берём только подходящие наборы, а если таких нет — убираем лишнее из набора
      const all = window.MEAL_TEMPLATES[key];
      const fits = all.filter((t) => !t.some(([id]) => window.foodConflicts(id, avoid).length));
      const templates = fits.length ? fits : all.map((t) => t.filter(([id]) => !window.foodConflicts(id, avoid).length)).filter((t) => t.length);
      if (!templates.length) continue;
      const idx = pick(templates.length, prev[key]);
      used[key] = idx;
      const tpl = templates[idx];
      const base = tpl.reduce((s, [id, g]) => s + FOOD[id].kcal * g / 100, 0);
      const scale = Math.min(2.5, Math.max(0.5, (state.target * share) / base));
      day[key] = tpl.map(([id, g]) => ({ id, g: Math.max(5, Math.round((g * scale) / 5) * 5) }));
    }
    state.days[dayIndex] = day;
    return used;
  }

  /* ---------- события ---------- */

  els.target.addEventListener('change', () => {
    const v = Math.round(Number(els.target.value));
    state.target = v >= 1000 && v <= 6000 ? v : state.target;
    render();
  });
  els.goal.addEventListener('change', () => { state.goal = els.goal.value; save(); });

  els.mode.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    state.mode = btn.dataset.mode;
    if (state.mode === 'day') state.day = 0;
    render();
  });

  els.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-day]');
    if (!btn) return;
    state.day = Number(btn.dataset.day);
    render();
  });

  document.getElementById('week-chart').addEventListener('click', (e) => {
    const col = e.target.closest('.week-col');
    if (!col) return;
    state.day = Number(col.dataset.day);
    render();
  });

  document.getElementById('auto-btn').addEventListener('click', () => {
    if (state.mode === 'week') {
      let prev = {};
      for (let i = 0; i < 7; i++) prev = autoFill(i, prev);
    } else {
      autoFill(0);
    }
    render();
    toast('Меню подобрано — можно поправить продукты и граммы');
  });

  els.copy.addEventListener('click', () => {
    const src = JSON.stringify(currentDay());
    state.days = state.days.map(() => JSON.parse(src));
    render();
    toast(`Меню на ${DAY_NAMES[state.day]} скопировано на всю неделю`);
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm(state.mode === 'week' ? 'Очистить меню на всю неделю?' : 'Очистить меню на день?')) return;
    if (state.mode === 'week') state.days = Array.from({ length: 7 }, emptyDay);
    else state.days[0] = emptyDay();
    render();
  });

  document.getElementById('print-btn').addEventListener('click', () => window.print());

  els.meals.addEventListener('change', (e) => {
    const input = e.target;
    if (input.matches('.meal-add select')) {
      const food = FOOD[input.value];
      input.form.grams.value = food ? food.portion : '';
      return;
    }
    if (input.matches('.meal-item .input')) {
      const g = Math.round(Number(input.value));
      const item = currentDay()[input.dataset.meal][Number(input.dataset.i)];
      if (g > 0 && g <= 2000) item.g = g;
      render();
    }
  });

  els.meals.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    currentDay()[btn.dataset.remove].splice(Number(btn.dataset.i), 1);
    render();
  });

  els.meals.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.food.value;
    const g = Math.round(Number(form.grams.value) || (FOOD[id] && FOOD[id].portion));
    if (!FOOD[id]) {
      form.food.classList.add('invalid');
      return;
    }
    if (!(g > 0 && g <= 2000)) {
      form.grams.classList.add('invalid');
      return;
    }
    currentDay()[form.dataset.meal].push({ id, g });
    render();
  });

  /* ---------- сохранение в аккаунт ---------- */

  let user = null;

  async function renderSaved() {
    const box = document.getElementById('saved-box');
    if (!user) {
      box.innerHTML = '<p class="form-note">Чтобы сохранять рационы и открывать их с любого устройства, <a href="login.html">войдите в аккаунт</a>.</p>';
      return;
    }
    try {
      const rows = await DB.rations.list();
      box.innerHTML = rows.length
        ? `<h3 style="font-size:1.05rem">Мои рационы</h3><ul class="saved-list">${rows.map((r) => `
            <li>
              <div><strong>${esc(r.title)}</strong><span class="small muted">${formatDate(r.created_at)} · ${r.data.mode === 'week' ? 'неделя' : 'день'}</span></div>
              <button class="btn btn-ghost btn-sm" type="button" data-load="${r.id}">Открыть</button>
              <button class="icon-btn" type="button" data-del="${r.id}" aria-label="Удалить">✕</button>
            </li>`).join('')}</ul>`
        : '<p class="small muted">Сохранённых рационов пока нет.</p>';
      box.onclick = async (e) => {
        const load = e.target.closest('[data-load]');
        const del = e.target.closest('[data-del]');
        if (load) {
          const row = rows.find((r) => String(r.id) === load.dataset.load);
          state = { ...newState(), ...row.data };
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast(`Открыт рацион «${row.title}»`);
        }
        if (del && confirm('Удалить этот рацион?')) {
          await DB.rations.remove(del.dataset.del);
          renderSaved();
        }
      };
    } catch (err) {
      box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  document.getElementById('save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!user) {
      location.href = 'login.html';
      return;
    }
    const titleInput = document.getElementById('save-title');
    const hasFood = state.days.some((d) => totals(d).kcal > 0);
    if (!hasFood) {
      toast('Сначала добавьте продукты в меню', 'error');
      return;
    }
    const title = titleInput.value.trim() || `Рацион на ${state.mode === 'week' ? 'неделю' : 'день'} · ${state.target} ккал`;
    try {
      await DB.rations.save({ title, data: state });
      titleInput.value = '';
      toast('Рацион сохранён в аккаунте');
      renderSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  render();
  userReady.then((u) => {
    user = u;
    if (u) avoid = DB.prefs.clean(u.prefs).avoid;
    renderSaved();
  });
})();
