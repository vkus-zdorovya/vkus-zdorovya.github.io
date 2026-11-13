/* Главная: быстрый расчёт ИМТ и превью сравнения продуктов */
(function () {
  const { esc } = window.UI;

  const form = document.getElementById('quick-bmi');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const h = parseFloat(String(form.height.value).replace(',', '.'));
    const w = parseFloat(String(form.weight.value).replace(',', '.'));
    const okH = h >= 100 && h <= 250;
    const okW = w >= 25 && w <= 300;
    form.height.classList.toggle('invalid', !okH);
    form.weight.classList.toggle('invalid', !okW);
    form.height.setAttribute('aria-invalid', String(!okH));
    form.weight.setAttribute('aria-invalid', String(!okW));
    const error = document.getElementById('qb-error');
    if (!okH || !okW) {
      // старый результат не должен оставаться на экране рядом с неверными данными
      document.getElementById('qb-result').classList.add('hidden');
      error.textContent = !okH
        ? (h > 0 && h < 3 ? 'Укажите рост в сантиметрах, а не в метрах (например, 170)' : 'Укажите рост от 100 до 250 см')
        : 'Укажите вес от 25 до 300 кг';
      return;
    }
    error.textContent = '';

    // категория считается по тому же числу, что показано на экране (округлённому до 0,1)
    const bmi = Math.round((w / (h / 100) ** 2) * 10) / 10;
    const cat = window.bmiCategory(bmi);
    document.getElementById('qb-value').textContent = bmi.toFixed(1).replace('.', ',');
    const note = document.getElementById('qb-note');
    note.textContent = cat.label;
    note.style.color = cat.color;
    document.getElementById('qb-result').classList.remove('hidden');
    DB.store.set('body', { ...DB.store.get('body', {}), height: h, weight: w });
  });

  const preview = document.getElementById('swap-preview');
  preview.innerHTML = window.SWAPS.slice(0, 6).map((s) => `
    <article class="swap reveal visible">
      <div class="swap-row swap-bad">
        <div class="swap-emoji" aria-hidden="true">${s.bad.emoji}</div>
        <div><div class="swap-label">Вместо</div><div class="swap-name">${esc(s.bad.name)}</div></div>
      </div>
      <div class="swap-arrow" aria-hidden="true">↓</div>
      <div class="swap-row swap-good">
        <div class="swap-emoji" aria-hidden="true">${s.good.emoji}</div>
        <div><div class="swap-label">Попробуйте</div><div class="swap-name">${esc(s.good.name)}</div></div>
      </div>
      <div class="swap-save">−${s.bad.kcal - s.good.kcal} ккал за порцию</div>
    </article>`).join('');
})();
