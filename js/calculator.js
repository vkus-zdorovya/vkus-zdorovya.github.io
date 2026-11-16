/* Калькулятор ИМТ / калорий и сравнение продуктов */
(function () {
  const { esc } = window.UI;
  const store = DB.store;

  /* ===================== Калькулятор ===================== */

  const form = document.getElementById('calc-form');
  const errorEl = form.querySelector('.form-error');
  const goalBox = document.getElementById('goal');
  let goal = 'maintain';

  const GOALS = {
    lose: { factor: 0.85, protein: 1.8, label: 'похудения' },
    maintain: { factor: 1, protein: 1.4, label: 'поддержания веса' },
    gain: { factor: 1.12, protein: 1.8, label: 'набора массы' },
  };

  function setGoal(value) {
    goal = value;
    goalBox.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.goal === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  goalBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-goal]');
    if (!btn) return;
    setGoal(btn.dataset.goal);
    // результат уже на экране — сразу пересчитываем под новую цель, чтобы не было противоречия
    const values = readValues();
    if (!document.getElementById('calc-result').classList.contains('hidden') && isValid(values)) {
      store.set('body', { ...values, goal });
      showResult(values, false);
    }
  });

  /* подставляем данные прошлого расчёта */
  const saved = store.get('body', {});
  ['sex', 'age', 'height', 'weight', 'activity'].forEach((key) => {
    if (saved[key] != null) form[key].value = saved[key];
  });
  if (saved.goal) setGoal(saved.goal);

  /* число из поля; экспоненциальную запись (1e2) не принимаем */
  const num = (v) => (/e/i.test(String(v)) ? NaN : parseFloat(String(v).replace(',', '.')));
  const readValues = () => ({
    sex: form.sex.value,
    age: num(form.age.value),
    height: num(form.height.value),
    weight: num(form.weight.value),
    activity: parseFloat(form.activity.value),
  });
  const isValid = (values) => Object.entries(RULES).every(([key, check]) => check(values[key]));

  const RULES = {
    sex: (v) => v === 'male' || v === 'female',
    age: (v) => v >= 14 && v <= 100,
    height: (v) => v >= 100 && v <= 250,
    weight: (v) => v >= 25 && v <= 300,
    activity: (v) => v >= 1.2 && v <= 1.9,
  };

  const MESSAGES = {
    sex: 'выберите пол',
    age: 'возраст 14–100 лет',
    height: 'рост 100–250 см',
    weight: 'вес 25–300 кг',
    activity: 'выберите уровень активности',
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = readValues();
    const wrong = [];
    for (const [key, check] of Object.entries(RULES)) {
      const ok = check(values[key]);
      form[key].classList.toggle('invalid', !ok);
      form[key].setAttribute('aria-invalid', String(!ok));
      if (!ok) wrong.push(key);
    }
    const result = document.getElementById('calc-result');
    if (wrong.length) {
      // старый результат не должен оставаться рядом с неверными данными
      result.classList.add('hidden');
      result.classList.remove('stale');
      const metres = wrong.includes('height') && values.height > 0 && values.height < 3;
      const list = wrong.map((k) => (k === 'height' && metres ? 'рост в сантиметрах, а не в метрах (например, 170)' : MESSAGES[k]));
      errorEl.textContent = `Проверьте: ${list.join(', ')}`;
      form[wrong[0]].focus();
      return;
    }
    errorEl.textContent = '';
    result.classList.remove('stale');
    store.set('body', { ...values, goal });
    const { bmi, kcal } = showResult(values);
    DB.calcs.add({ ...values, goal, bmi: +bmi.toFixed(1), kcal }).catch((err) => console.warn(err));
  });

  function showResult({ sex, age, height, weight, activity }, scroll = true) {
    const bmi = weight / (height / 100) ** 2;
    const cat = window.bmiCategory(bmi);
    const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
    const tdee = bmr * activity;
    const g = GOALS[goal];
    // при ИМТ ниже нормы дефицит не считаем, а норму для похудения не опускаем ниже безопасного минимума
    // (1200 ккал женщинам, 1500 мужчинам — как в статье о калориях), но и не выше поддержания
    const underweight = cat.key === 'severe' || cat.key === 'under';
    const noDeficit = goal === 'lose' && underweight;
    const minKcal = sex === 'male' ? 1500 : 1200;
    let kcal = Math.round((tdee * (noDeficit ? 1 : g.factor)) / 10) * 10;
    const floored = goal === 'lose' && !noDeficit && kcal < minKcal;
    if (floored) kcal = Math.round(Math.min(minKcal, tdee) / 10) * 10;
    // белок не больше 35% калорий, иначе на крайних входах БЖУ не сходится с нормой
    const protein = Math.min(Math.round(weight * g.protein), Math.floor((kcal * 0.35) / 4));
    // округляем вниз, чтобы сумма Б·4 + Ж·9 + У·4 не превышала норму
    const fat = Math.floor((kcal * 0.3) / 9);
    const carbs = Math.max(0, Math.floor((kcal - protein * 4 - fat * 9) / 4));
    const waterL = Math.round((weight * 3) / 10) / 10;
    const glasses = Math.ceil((waterL * 1000) / 250);
    const minW = 18.5 * (height / 100) ** 2;
    const maxW = 24.9 * (height / 100) ** 2;

    document.getElementById('r-bmi').textContent = bmi.toFixed(1).replace('.', ',');
    const label = document.getElementById('r-bmi-label');
    label.textContent = cat.label;
    label.style.color = cat.color;
    document.getElementById('r-kcal').textContent = kcal.toLocaleString('ru-RU');
    const tdeeText = `Поддержание: ${Math.round(tdee).toLocaleString('ru-RU')} ккал`;
    document.getElementById('r-tdee').textContent = noDeficit
      ? `ИМТ ниже нормы — дефицит не применяется. ${tdeeText}`
      : floored
        ? `Для ${g.label}, не ниже безопасного минимума. ${tdeeText}`
        : `Для ${g.label}. ${tdeeText}`;
    document.getElementById('r-water').textContent = waterL.toLocaleString('ru-RU', { minimumFractionDigits: 1 });
    document.getElementById('r-glasses').textContent = `≈ ${glasses} ${glassWord(glasses)} по 250 мл`;
    document.getElementById('r-ideal').textContent =
      `Нормальный вес при вашем росте: ${minW.toFixed(0)}–${maxW.toFixed(0)} кг`;

    const result = document.getElementById('calc-result');
    result.classList.remove('hidden');

    /* шкала ИМТ: от 15 до 40 */
    const pos = Math.min(100, Math.max(0, ((bmi - 15) / 25) * 100));
    const marker = document.getElementById('bmi-marker');
    // маркер шириной 28 px не выходит за края шкалы
    const at = (p) => `clamp(14px, ${p}%, calc(100% - 14px))`;
    marker.style.left = at(0);
    requestAnimationFrame(() => requestAnimationFrame(() => { marker.style.left = at(pos); }));

    const macros = [
      ['Белки', protein, '#3c8a3f', protein * 4],
      ['Жиры', fat, '#e8c33c', fat * 9],
      ['Углеводы', carbs, '#6aa9e9', carbs * 4],
    ];
    const bars = document.getElementById('macro-bars');
    bars.innerHTML = macros.map(([name, grams, color, kc]) => `
      <div class="macro-row">
        <span>${name}</span>
        <div class="macro-track"><div class="macro-fill" style="background:${color}" data-w="${(kc / kcal) * 100}"></div></div>
        <span>${grams} г</span>
      </div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bars.querySelectorAll('.macro-fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    }));

    const tips = buildTips(cat.key, goal, waterL);
    if (floored) tips.unshift(`Норма поднята до ${kcal.toLocaleString('ru-RU')} ккал: есть меньше ${minKcal} ккал в день без врача не рекомендуется. Лучше добавьте активности.`);
    document.getElementById('tips').innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');

    store.set('target', { kcal, goal, protein, fat, carbs });
    document.getElementById('to-diet').textContent = `Собрать рацион на ${kcal.toLocaleString('ru-RU')} ккал`;

    renderWater(glasses);
    if (scroll) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return { bmi, kcal };
  }

  function buildTips(catKey, goalKey, waterL) {
    const tips = [];
    if (catKey === 'severe' || catKey === 'under') {
      tips.push('Ешьте 5–6 раз в день небольшими порциями — так проще получить достаточно энергии.');
      tips.push('Добавляйте полезные калорийные продукты: орехи, авокадо, цельнозерновые крупы, рыбу.');
      tips.push('Совмещайте питание с силовыми тренировками, чтобы набирать мышцы, а не жир.');
      if (catKey === 'severe') tips.push('При выраженном дефиците массы тела обязательно обратитесь к врачу.');
    } else if (catKey === 'normal') {
      tips.push('Ваш вес в норме — поддерживайте разнообразный рацион и регулярную активность.');
      tips.push('Заполняйте половину тарелки овощами, четверть — белком, четверть — сложными углеводами.');
    } else {
      tips.push('Создавайте умеренный дефицит калорий — 10–20% от нормы. Жёсткие диеты приводят к срывам.');
      tips.push('Начните с замены сладких напитков на воду — это самый простой способ снизить калорийность.');
      tips.push('Ешьте больше белка и овощей: они дольше насыщают при меньшей калорийности.');
      tips.push('Добавьте ежедневную ходьбу: 7–10 тысяч шагов заметно увеличивают расход энергии.');
      if (catKey === 'obese2' || catKey === 'obese3') tips.push('При ожирении II–III степени снижать вес лучше под наблюдением врача.');
    }
    if (goalKey === 'gain' && catKey !== 'severe' && catKey !== 'under') tips.push('Для набора мышечной массы получайте белок в каждом приёме пищи и не пропускайте тренировки.');
    if (goalKey === 'lose' && (catKey === 'under' || catKey === 'severe')) tips.push('Ваш ИМТ ниже нормы — снижать вес не рекомендуется. Попробуйте цель «Поддерживать вес».');
    tips.push(`Выпивайте около ${waterL.toLocaleString('ru-RU')} л воды в день, больше — в жару и при тренировках.`);
    return tips;
  }

  /* «стакан», «стакана», «стаканов» */
  function glassWord(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'стакан';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'стакана';
    return 'стаканов';
  }

  /* трекер воды на сегодня; дата — по местному времени, чтобы сброс был в местную полночь */
  function renderWater(total) {
    const d = new Date();
    const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const log = store.get('water', {});
    let drunk = log.date === today ? log.count : 0;
    const box = document.getElementById('glasses');
    const count = document.getElementById('water-count');

    const draw = () => {
      box.innerHTML = Array.from({ length: total }, (_, i) =>
        `<button type="button" class="glass${i < drunk ? ' full' : ''}" data-i="${i}" aria-label="Стакан ${i + 1}"></button>`).join('');
      count.textContent = drunk >= total ? '🎉 Норма воды на сегодня выполнена!' : `${drunk} из ${total} ${total % 10 === 1 && total % 100 !== 11 ? 'стакана' : 'стаканов'}`;
    };
    box.onclick = (e) => {
      const btn = e.target.closest('.glass');
      if (!btn) return;
      const i = Number(btn.dataset.i);
      drunk = i < drunk ? i : i + 1;
      store.set('water', { date: today, count: drunk });
      draw();
    };
    draw();
  }

  // пользователь уже считал — сразу показываем результат без прокрутки
  if (isValid(saved)) showResult(saved, false);

  // данные изменили, а «Рассчитать» не нажали — помечаем результат как устаревший
  form.addEventListener('input', (e) => {
    if (e.target.closest('#goal')) return;
    document.getElementById('calc-result').classList.add('stale');
  });

  /* ===================== Сравнение продуктов ===================== */

  const swaps = window.SWAPS;
  const select = document.getElementById('bad-select');
  const chips = document.getElementById('swap-chips');
  select.innerHTML = swaps.map((s) => `<option value="${s.id}">${s.bad.emoji} ${esc(s.bad.name)}</option>`).join('');
  chips.innerHTML = swaps.map((s) => `<button type="button" class="chip" data-id="${s.id}">${s.bad.emoji} ${esc(s.bad.name)}</button>`).join('');

  function showSwap(id) {
    const s = swaps.find((x) => x.id === id) || swaps[0];
    select.value = s.id;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id === s.id));
    document.getElementById('good-box').innerHTML = `<span style="font-size:1.5rem">${s.good.emoji}</span> ${esc(s.good.name)}`;
    document.getElementById('leg-bad').textContent = `${s.bad.name}, ${s.bad.portion}`;
    document.getElementById('leg-good').textContent = `${s.good.name}, ${s.good.portion}`;

    const chart = document.getElementById('compare-chart');
    chart.innerHTML = window.SWAP_METRICS.map((m) => {
      const a = s.bad[m.key];
      const b = s.good[m.key];
      const max = Math.max(a, b) || 1;
      const diff = b - a;
      const better = m.lessIsBetter ? diff < 0 : diff > 0;
      const diffText = diff === 0 ? 'без разницы'
        : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} ${m.unit}`;
      return `
        <div>
          <div class="cmp-metric-head"><span>${m.label}</span><span class="diff" style="color:${diff === 0 ? 'var(--muted)' : better ? 'var(--accent-text)' : 'var(--danger-text)'}">${diffText}</span></div>
          <div class="cmp-bar">
            <div class="cmp-line"><div class="cmp-track"><div class="cmp-fill bad" data-w="${(a / max) * 100}"></div></div><span>${fmt(a)} ${m.unit}</span></div>
            <div class="cmp-line"><div class="cmp-track"><div class="cmp-fill good" data-w="${(b / max) * 100}"></div></div><span>${fmt(b)} ${m.unit}</span></div>
          </div>
        </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chart.querySelectorAll('.cmp-fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    }));

    const saveKcal = s.bad.kcal - s.good.kcal;
    const kg = (saveKcal * 365) / 7700;
    document.getElementById('cmp-year').textContent = `≈ ${kg.toFixed(1).replace('.', ',')} кг`;
    document.getElementById('cmp-week').textContent = `${(saveKcal * 7).toLocaleString('ru-RU')} ккал`;
    document.getElementById('cmp-tip').innerHTML = `<li>${esc(s.tip)}</li>`;
  }

  function fmt(n) {
    // малые значения (соль 0,03 г) показываем с двумя знаками, чтобы не выходило «0 г» и «−0 г»
    return Number.isInteger(n) ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(n) < 0.1 ? 2 : 1 });
  }

  select.addEventListener('change', () => showSwap(select.value));
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) showSwap(chip.dataset.id);
  });
  showSwap(swaps[0].id);
})();
