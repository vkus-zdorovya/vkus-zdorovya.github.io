/* Список покупок из рациона: рецепты раскладываются на продукты, готовые блюда пересчитываются в сырые */
(function () {
  const { esc, toast } = window.UI;
  const { MEALS, FOOD, getDraft } = window.PLAN;
  const BUY = window.FOOD_BUY;
  const recipes = Object.fromEntries(window.RECIPES.map((r) => [r.id, r]));

  const box = document.getElementById('shop');
  let checked = DB.store.get('shop_checked', {});

  function collect() {
    const draft = getDraft();
    const days = draft.mode === 'week' ? draft.days : [draft.days[0]];
    const need = {};
    const addFood = (id, g) => { need[id] = (need[id] || 0) + g; };

    days.forEach((day) => MEALS.forEach(([key]) => day[key].forEach(({ id, g }) => {
      const f = FOOD[id];
      if (!f) return;
      if (f.recipe) {
        const r = recipes[f.recipe];
        r.items.forEach(([part, pg]) => addFood(part, (pg * g) / r.portion));
      } else {
        addFood(id, g);
      }
    })));

    /* пересчёт в покупки и группировка по категориям */
    const groups = {};
    Object.entries(need).forEach(([id, g]) => {
      const f = FOOD[id];
      if (BUY[id] === null) return;
      const [name, k] = BUY[id] || [f.name.replace(/\s*\(.*\)$/, ''), 1];
      const group = (groups[f.cat] = groups[f.cat] || {});
      group[name] = { grams: (group[name] ? group[name].grams : 0) + g * k, eggs: id === 'egg' };
    });
    return { groups, week: draft.mode === 'week', empty: !Object.keys(need).length };
  }

  function qty({ grams, eggs }) {
    if (eggs) return `${Math.max(1, Math.round(grams / 55))} шт`;
    if (grams >= 1000) return `${(Math.ceil(grams / 100) / 10).toLocaleString('ru-RU')} кг`;
    return `${Math.max(10, Math.ceil(grams / 10) * 10)} г`;
  }

  let current = null;

  function render() {
    current = collect();
    const info = document.getElementById('shop-info');
    if (current.empty) {
      info.textContent = '';
      box.innerHTML = '<p class="form-note">Рацион пока пуст. <a href="diet.html">Соберите меню</a> или добавьте блюда из <a href="recipes.html">рецептов</a> — и список появится здесь.</p>';
      return;
    }
    info.textContent = current.week ? 'Список на неделю (7 дней).' : 'Список на один день. Переключите конструктор в режим «Неделя», чтобы закупиться на 7 дней.';
    box.innerHTML = Object.entries(current.groups).map(([cat, items]) => `
      <div class="shop-group">
        <h3>${esc(cat)}</h3>
        <ul class="shop-list">${Object.entries(items).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([name, item]) => `
          <li><label>
            <input type="checkbox" data-name="${esc(name)}"${checked[name] ? ' checked' : ''}>
            <span>${esc(name)}</span><span class="qty">${qty(item)}</span>
          </label></li>`).join('')}
        </ul>
      </div>`).join('');
  }

  function asText() {
    return 'Список покупок — ВкусЗдоровья\n\n' + Object.entries(current.groups).map(([cat, items]) =>
      `${cat}:\n` + Object.entries(items).map(([name, item]) => `${checked[name] ? '✓' : '•'} ${name} — ${qty(item)}`).join('\n')
    ).join('\n\n');
  }

  box.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) checked[cb.dataset.name] = true;
    else delete checked[cb.dataset.name];
    DB.store.set('shop_checked', checked);
  });

  document.getElementById('copy').addEventListener('click', async () => {
    if (current.empty) return;
    try {
      await navigator.clipboard.writeText(asText());
      toast('Список скопирован — вставьте его в заметки или мессенджер');
    } catch {
      toast('Не удалось скопировать', 'error');
    }
  });

  const shareBtn = document.getElementById('share');
  if (navigator.share) {
    shareBtn.classList.remove('hidden');
    shareBtn.addEventListener('click', () => {
      if (!current.empty) navigator.share({ title: 'Список покупок', text: asText() }).catch(() => {});
    });
  }

  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('reset').addEventListener('click', () => {
    checked = {};
    DB.store.set('shop_checked', checked);
    render();
  });

  render();
})();
