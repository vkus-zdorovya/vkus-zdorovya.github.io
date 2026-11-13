/* Кабинет: предпочтения в питании, цель по весу, отчёт за неделю, достижения, цвет сайта */
(function () {
  const { esc, toast, userReady } = window.UI;
  const $ = (id) => document.getElementById(id);
  const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const parse = (s) => new Date(s + 'T12:00:00');
  const shift = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const num = (v, digits = 0) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits });
  const dateRu = (s) => parse(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  let prefs = { avoid: [], goal: null };
  let weights = [];

  /* ===================== Предпочтения ===================== */

  function renderPrefs() {
    $('prefs').innerHTML = Object.entries(window.AVOID).map(([key, rule]) => `
      <label class="pref"><input type="checkbox" value="${key}"${prefs.avoid.includes(key) ? ' checked' : ''}>
        <span aria-hidden="true">${rule.icon}</span> ${esc(rule.label)}</label>`).join('');
  }
  $('prefs').addEventListener('change', async () => {
    const avoid = [...$('prefs').querySelectorAll('input:checked')].map((i) => i.value);
    try {
      prefs = await DB.prefs.set({ ...prefs, avoid });
      toast('Предпочтения сохранены');
    } catch (error) {
      toast(error.message, 'error');
      renderPrefs();
    }
  });

  /* ===================== Цель по весу ===================== */

  const KCAL_PER_KG = 7700; // примерная энергетическая ценность 1 кг массы тела
  const body = () => DB.store.get('body');
  const currentWeight = () => (weights.length ? Number(weights[weights.length - 1].weight) : body() ? Number(body().weight) : null);

  function goalPlan(goal) {
    const b = body();
    const cur = currentWeight();
    if (!b || !cur) return { note: 'Сначала рассчитайте свою норму в <a href="calculator.html">калькуляторе</a> — для плана нужны рост, возраст и уровень активности.' };
    const days = Math.round((parse(goal.date) - parse(iso())) / 864e5);
    const diff = cur - goal.weight; // > 0 — нужно снизить вес
    const bmiTarget = goal.weight / (b.height / 100) ** 2;
    const tdee = (10 * cur + 6.25 * b.height - 5 * b.age + (b.sex === 'male' ? 5 : -161)) * b.activity;

    if (bmiTarget < 18.5) {
      return { stop: `Вес ${num(goal.weight, 1)} кг при вашем росте — это ИМТ ${num(bmiTarget, 1)}, ниже нормы по ВОЗ (18,5). Мы не строим план для такой цели. Нижняя граница нормы для вас — около ${num(18.5 * (b.height / 100) ** 2)} кг. Если вам нужен меньший вес, обсудите это с врачом.` };
    }
    if (Math.abs(diff) < 0.3) return { done: true, cur };
    if (!(days >= 7)) return { note: 'Выберите дату хотя бы через неделю от сегодняшней.' };
    if (b.age < 18 && diff > 0) {
      return { stop: 'До 18 лет организм растёт, и снижать калории без врача небезопасно. Вместо дефицита калорий помогут регулярное питание, меньше сладких напитков и больше движения. Обсудите цель с врачом или родителями.' };
    }

    const perDay = (diff * KCAL_PER_KG) / days; // > 0 — дефицит
    const floor = b.sex === 'male' ? 1500 : 1200;
    const max = diff > 0
      ? Math.max(0, Math.min(1000, tdee - floor, (cur * 0.01 * KCAL_PER_KG) / 7)) // не больше 1 % веса в неделю и не ниже минимума калорий
      : 500;
    const safeDays = max > 0 ? Math.ceil((Math.abs(diff) * KCAL_PER_KG) / max) : null;
    const base = { cur, diff, days, tdee, bmiTarget, weekly: (Math.abs(diff) / days) * 7 };
    if (Math.abs(perDay) > max + 1) return { ...base, tooFast: true, safeDate: safeDays ? shift(iso(), safeDays) : null };
    return { ...base, kcal: Math.round((tdee - perDay) / 10) * 10, perDay };
  }

  function renderGoal() {
    const box = $('goal-result');
    const goal = prefs.goal;
    if (!goal) {
      box.innerHTML = '<p class="small muted" style="margin-top:12px">Укажите желаемый вес и дату — посчитаем, сколько калорий в день нужно и реальны ли сроки.</p>';
      return;
    }
    $('goal-weight').value = goal.weight;
    $('goal-date').value = goal.date;
    const plan = goalPlan(goal);
    const reset = '<button class="link-btn danger" type="button" id="goal-reset">Убрать цель</button>';
    if (plan.note) { box.innerHTML = `<p class="form-note" style="margin-top:12px">${plan.note}</p>${reset}`; return; }
    if (plan.stop) { box.innerHTML = `<p class="form-note warn" style="margin-top:12px">${esc(plan.stop)}</p>${reset}`; return; }
    if (plan.done) { box.innerHTML = `<div class="verdict good" style="margin-top:12px">🎉 Цель достигнута: сейчас ${num(plan.cur, 1)} кг. Теперь важно удержать вес — переключите калькулятор на «поддержание».</div>${reset}`; return; }

    const lose = plan.diff > 0;
    const start = goal.start || plan.cur;
    const passed = Math.max(0, Math.min(1, (start - plan.cur) / (start - goal.weight || 1)));
    const progress = `
      <div class="goal-progress" role="img" aria-label="Пройдено ${Math.round(passed * 100)} % пути к цели">
        <div class="goal-track"><i style="width:${passed * 100}%"></i></div>
        <div class="goal-ends small muted"><span>старт ${num(start, 1)} кг</span><b>сейчас ${num(plan.cur, 1)} кг</b><span>цель ${num(goal.weight, 1)} кг</span></div>
      </div>`;
    if (plan.tooFast) {
      box.innerHTML = `${progress}
        <p class="form-note warn">⚠️ Слишком быстрый темп: ${num(plan.weekly, 1)} кг в неделю. Безопасно ${lose ? 'снижать вес не быстрее 1 % массы тела в неделю и не есть меньше ' + (body().sex === 'male' ? '1500' : '1200') + ' ккал в день' : 'набирать не больше 0,5 кг в неделю'}.
        ${plan.safeDate ? `Реалистичная дата — <b>${dateRu(plan.safeDate)}</b>.` : ''}</p>
        ${plan.safeDate ? `<button class="btn btn-lime btn-sm" type="button" id="goal-safe" data-date="${plan.safeDate}">Поставить эту дату</button> ` : ''}${reset}`;
      return;
    }
    const target = DB.store.get('target') || {};
    const applied = Math.abs((target.kcal || 0) - plan.kcal) < 15;
    box.innerHTML = `${progress}
      <div class="result-grid goal-grid">
        <div class="stat"><div class="stat-label">Калорий в день</div><div class="stat-value">${num(plan.kcal)}</div><div class="stat-note muted">${lose ? 'дефицит' : 'профицит'} ${num(Math.abs(plan.perDay))} ккал</div></div>
        <div class="stat"><div class="stat-label">Темп</div><div class="stat-value">${num(plan.weekly, 1)} <small>кг/нед</small></div><div class="stat-note muted">осталось ${num(Math.abs(plan.diff), 1)} кг</div></div>
        <div class="stat"><div class="stat-label">Срок</div><div class="stat-value">${plan.days} <small>дн.</small></div><div class="stat-note muted">до ${parse(goal.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div></div>
      </div>
      ${plan.bmiTarget > 24.9 && !lose ? '<p class="form-note warn">Желаемый вес выше нормы по ВОЗ для вашего роста.</p>' : ''}
      <div class="hero-actions" style="margin-top:12px">
        ${applied ? '<span class="tag">✓ Эта норма уже используется в дневнике и рационе</span>' : `<button class="btn btn-primary btn-sm" type="button" id="goal-apply" data-kcal="${plan.kcal}" data-lose="${lose ? 1 : 0}">Использовать ${num(plan.kcal)} ккал как мою норму</button>`}
        ${reset}
      </div>
      <p class="small muted" style="margin-top:10px">Расчёт ориентировочный. При хронических заболеваниях, беременности и кормлении грудью обсудите цель с врачом.</p>`;
  }

  $('goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const weight = Number(String($('goal-weight').value).replace(',', '.'));
    const date = $('goal-date').value;
    if (!(weight >= 30 && weight <= 300) || !date) { toast('Укажите желаемый вес и дату', 'error'); return; }
    await saveGoal({ weight, date, start: currentWeight() });
  });
  $('goal-result').addEventListener('click', async (e) => {
    if (e.target.closest('#goal-reset')) {
      $('goal-weight').value = '';
      $('goal-date').value = '';
      await saveGoal(null);
    }
    const safe = e.target.closest('#goal-safe');
    if (safe) await saveGoal({ ...prefs.goal, date: safe.dataset.date });
    const apply = e.target.closest('#goal-apply');
    if (apply) {
      const kcal = Number(apply.dataset.kcal);
      const cur = currentWeight();
      const protein = Math.round(cur * (apply.dataset.lose === '1' ? 1.6 : 1.8));
      const fat = Math.round((kcal * 0.3) / 9);
      DB.store.set('target', { kcal, goal: apply.dataset.lose === '1' ? 'lose' : 'gain', protein, fat, carbs: Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4)) });
      toast(`Норма ${num(kcal)} ккал применена: её используют дневник и конструктор рациона`);
      renderGoal();
      loadWeek();
    }
  });
  async function saveGoal(goal) {
    try {
      prefs = await DB.prefs.set({ ...prefs, goal });
      renderGoal();
    } catch (error) { toast(error.message, 'error'); }
  }

  /* ===================== Отчёт за неделю ===================== */

  async function loadWeek() {
    const box = $('week-report');
    const to = iso();
    const from = shift(to, -6);
    let rows = [];
    let acts = [];
    try { rows = await DB.diary.list(from, to); } catch (error) { box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; return; }
    try { acts = await DB.activity.list(from, to); } catch { acts = []; }

    const target = DB.store.get('target') || {};
    const kcalTarget = target.kcal || 2000;
    const macroTarget = {
      protein: target.protein || Math.round((kcalTarget * 0.2) / 4),
      fat: target.fat || Math.round((kcalTarget * 0.3) / 9),
      carbs: target.carbs || Math.round((kcalTarget * 0.5) / 4),
    };
    const days = Array.from({ length: 7 }, (_, i) => shift(from, i));
    const perDay = days.map((d) => rows.filter((r) => r.date === d).reduce((s, r) => s + Number(r.kcal), 0));
    const logged = perDay.filter((k) => k > 0);
    if (!logged.length) {
      box.innerHTML = '<p class="muted">За последние 7 дней в дневнике пусто. Запишите, что съели сегодня, в <a href="diary.html">дневнике питания</a> — и здесь появится разбор недели.</p>';
      return;
    }
    const avg = logged.reduce((a, b) => a + b, 0) / logged.length;
    const inNorm = logged.filter((k) => Math.abs(k - kcalTarget) <= kcalTarget * 0.1).length;
    const macro = (key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0) / logged.length;
    const burned = acts.reduce((s, a) => s + Number(a.kcal), 0);

    const before = weights.filter((w) => w.date < from).pop();
    const inside = weights.filter((w) => w.date >= from);
    const wFrom = before || inside[0];
    const wTo = inside[inside.length - 1];
    const wDelta = wFrom && wTo && wFrom !== wTo ? Number(wTo.weight) - Number(wFrom.weight) : null;

    const tips = [];
    if (logged.length < 4) tips.push(`Записи есть только за ${logged.length} ${logged.length === 1 ? 'день' : 'дня'} из 7 — по ним картина неточная. Постарайтесь записывать каждый день.`);
    if (avg > kcalTarget * 1.1) tips.push(`В среднем вы превышаете норму на ${num(avg - kcalTarget)} ккал в день. Проще всего убрать их за счёт сладких напитков и перекусов.`);
    else if (avg < kcalTarget * 0.8) tips.push(`В среднем вы недоедаете ${num(kcalTarget - avg)} ккал в день. Слишком мало есть тоже вредно: добавьте полноценный приём пищи.`);
    else tips.push('По калориям вы держитесь рядом с нормой — так держать.');
    const pShare = macro('protein') / macroTarget.protein;
    if (pShare < 0.8) tips.push(`Белка выходит около ${num(macro('protein'))} г при норме ${macroTarget.protein} г. Добавьте блюда с белком к каждому приёму пищи.`);
    if (macro('fat') / macroTarget.fat > 1.25) tips.push('Жиров больше нормы. Обратите внимание на жареное, соусы и выпечку.');
    if (!acts.length) tips.push('За неделю не записано ни одной тренировки. Даже 30 минут ходьбы в день заметно помогают.');

    const max = Math.max(kcalTarget * 1.2, ...perDay);
    box.innerHTML = `
      <div class="result-grid report-grid">
        <div class="stat"><div class="stat-label">Дней с записями</div><div class="stat-value">${logged.length} <small>из 7</small></div></div>
        <div class="stat"><div class="stat-label">В среднем за день</div><div class="stat-value">${num(avg)} <small>ккал</small></div><div class="stat-note muted">норма ${num(kcalTarget)}</div></div>
        <div class="stat"><div class="stat-label">Дней в норме (±10 %)</div><div class="stat-value">${inNorm} <small>из ${logged.length}</small></div></div>
        <div class="stat"><div class="stat-label">Вес за неделю</div><div class="stat-value">${wDelta == null ? '—' : (wDelta > 0 ? '+' : '') + num(wDelta, 1) + ' <small>кг</small>'}</div>${wDelta == null ? '<div class="stat-note muted">нужно 2 взвешивания</div>' : ''}</div>
      </div>
      <div class="report-row">
        <div class="report-chart" role="img" aria-label="Калории по дням за неделю">
          <div class="target-line" style="bottom:${24 + (kcalTarget / max) * 110}px"></div>
          ${days.map((d, i) => `<div class="report-col" title="${parse(d).toLocaleDateString('ru-RU')}: ${num(perDay[i])} ккал"><i style="height:${(perDay[i] / max) * 110}px" class="${perDay[i] > kcalTarget * 1.1 ? 'over' : ''}"></i><span>${parse(d).toLocaleDateString('ru-RU', { weekday: 'short' })}</span></div>`).join('')}
        </div>
        <div class="report-macros">
          ${[['Белки', 'protein', '#3c8a3f'], ['Жиры', 'fat', '#e8c33c'], ['Углеводы', 'carbs', '#6aa9e9']].map(([label, key, color]) => `
            <div class="macro-row"><span>${label}</span>
              <div class="macro-track"><div class="macro-fill" style="background:${color};width:${Math.min(100, (macro(key) / macroTarget[key]) * 100)}%"></div></div>
              <span>${num(macro(key))}/${macroTarget[key]} г</span></div>`).join('')}
          ${burned ? `<p class="small muted" style="margin:8px 0 0">🏃 Активность за неделю: ${acts.length} ${acts.length === 1 ? 'запись' : 'записей'}, около ${num(burned)} ккал.</p>` : ''}
        </div>
      </div>
      <ul class="tips">${tips.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ul>`;
  }

  /* ===================== Достижения ===================== */

  async function loadBadges(user) {
    const box = $('badges');
    if (!user && DB.mode !== 'demo') {
      box.innerHTML = '<p class="muted"><a href="login.html">Войдите</a>, чтобы получать достижения: они считаются по вашему дневнику, форуму и челленджам.</p>';
      return;
    }
    let s;
    try { s = await DB.stats(user ? user.id : 'guest'); } catch (error) { box.innerHTML = `<p class="form-note">${esc(error.message)}</p>`; return; }
    const earned = window.BADGES.filter((b) => Number(s[b.key] || 0) >= b.goal);
    box.innerHTML = `
      <p class="badge-summary">Получено <b>${earned.length} из ${window.BADGES.length}</b>${s.streak ? ` · 🔥 серия в дневнике: <b>${s.streak} ${s.streak === 1 ? 'день' : s.streak < 5 ? 'дня' : 'дней'}</b>` : ''}</p>
      <div class="badges">${window.BADGES.map((b) => {
        const have = Number(s[b.key] || 0);
        const ok = have >= b.goal;
        return `<div class="badge-tile${ok ? ' earned' : ''}">
          <span class="badge-icon" aria-hidden="true">${b.icon}</span>
          <b>${esc(b.title)}</b>
          <span class="small muted">${esc(b.desc)}</span>
          ${ok ? '<span class="tag">✓ получено</span>' : `<span class="badge-bar" role="img" aria-label="${have} из ${b.goal}"><i style="width:${Math.min(100, (have / b.goal) * 100)}%"></i></span><span class="small muted">${have} из ${b.goal}</span>`}
        </div>`;
      }).join('')}</div>`;
  }

  /* ===================== Цвет сайта ===================== */

  function renderPalette() {
    const now = UI.accent();
    $('palette').innerHTML = window.PALETTES.map(([id, label, color]) =>
      `<button type="button" data-accent="${id}" aria-pressed="${id === now}"><i style="background:${color}"></i>${esc(label)}</button>`).join('');
  }
  $('palette').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accent]');
    if (!btn) return;
    UI.setAccent(btn.dataset.accent);
    renderPalette();
  });

  /* ===================== старт ===================== */

  userReady.then(async (user) => {
    prefs = DB.prefs.clean(user ? user.prefs : DB.store.get('prefs'));
    renderPrefs();
    renderPalette();
    $('goal-date').min = shift(iso(), 7);
    try { weights = await DB.weights.list(); } catch { weights = []; }
    renderGoal();
    loadWeek();
    loadBadges(user);
  });
  // после новой записи веса пересчитываем цель и отчёт
  document.getElementById('weight-form').addEventListener('submit', () => setTimeout(async () => {
    try { weights = await DB.weights.list(); } catch { /* оставляем прежние */ }
    renderGoal();
    loadWeek();
  }, 800));
})();
