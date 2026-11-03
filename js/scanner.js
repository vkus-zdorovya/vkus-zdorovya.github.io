/* Сканер штрихкодов: камера (BarcodeDetector или библиотека ZXing) + база Open Food Facts */
(function () {
  const { esc, toast } = window.UI;
  const ZXING_URL = 'js/vendor/zxing.min.js';
  // товары ищутся через Supabase (DB.products): наша база + Open Food Facts со стороны сервера — работает без VPN

  const video = document.getElementById('video');
  const frame = document.getElementById('frame');
  const camBtn = document.getElementById('cam-btn');
  const stopBtn = document.getElementById('stop-btn');
  const camError = document.getElementById('cam-error');
  const productEl = document.getElementById('product');

  let stream = null;
  let zxingReader = null;
  let detectTimer = null;

  /* ===================== Камера ===================== */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить модуль сканера. Проверьте интернет.'));
      document.head.appendChild(s);
    });
  }

  async function nativeDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => formats.includes(f));
      return wanted.length ? new BarcodeDetector({ formats: wanted }) : null;
    } catch {
      return null;
    }
  }

  async function startCamera() {
    camError.textContent = '';
    if (!window.isSecureContext || !navigator.mediaDevices) {
      camError.textContent = 'Камера работает только на сайте с https (после публикации) или на localhost.';
      return;
    }
    camBtn.disabled = true;
    try {
      const detector = await nativeDetector();
      frame.classList.remove('hidden');
      if (detector) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (!stream) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) return onCode(codes[0].rawValue);
          } catch { /* кадр ещё не готов */ }
          detectTimer = setTimeout(tick, 250);
        };
        tick();
      } else {
        if (!window.ZXing) await loadScript(ZXING_URL);
        zxingReader = new ZXing.BrowserMultiFormatReader();
        await zxingReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
          if (result) onCode(result.getText());
        });
      }
      camBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } catch (err) {
      stopCamera();
      camError.textContent = err && err.name === 'NotAllowedError'
        ? 'Доступ к камере запрещён. Разрешите его в настройках браузера для этого сайта.'
        : err && err.name === 'NotFoundError' ? 'Камера не найдена. Введите штрихкод вручную.' : (err.message || 'Не удалось включить камеру');
    } finally {
      camBtn.disabled = false;
    }
  }

  function stopCamera() {
    clearTimeout(detectTimer);
    if (zxingReader) { zxingReader.reset(); zxingReader = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video.srcObject = null;
    frame.classList.add('hidden');
    camBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }

  function onCode(code) {
    stopCamera();
    if (navigator.vibrate) navigator.vibrate(80);
    document.getElementById('code').value = code;
    lookup(code);
  }

  /* ===================== Поиск продукта ===================== */

  async function lookup(code) {
    code = String(code).replace(/\D/g, '');
    if (code.length < 8) {
      toast('Штрихкод должен содержать 8–14 цифр', 'error');
      return;
    }
    productEl.innerHTML = '<div class="card center muted">Ищем продукт…</div>';
    let found;
    try {
      found = await DB.products.lookup(code);
    } catch {
      productEl.innerHTML = '<div class="card form-error">Не удалось связаться с базой продуктов. Проверьте интернет и попробуйте ещё раз.</div>';
      return;
    }
    if (!found || !found.product) return notFound(code);
    renderProduct(code, found.product, found.source);
    remember(code, productName(found.product));
  }

  /* ===================== Добавление товара участником ===================== */

  async function notFound(code) {
    const user = await UI.userReady;
    if (!BARCODE.valid(code)) {
      productEl.innerHTML = `
        <div class="card">
          <h3>Похоже, в штрихкоде ошибка</h3>
          <p class="muted">У кода ${esc(code)} не сходится контрольная цифра — последняя цифра штрихкода, которая проверяет остальные.
            Сверьте цифры под полосками на упаковке и введите их ещё раз. Штрихкоды бывают из 8, 12 или 13 цифр.</p>
        </div>`;
      return;
    }
    productEl.innerHTML = `
      <div class="card">
        <h3>Продукт не найден</h3>
        <p class="muted">Штрихкода ${esc(code)} пока нет ни в нашей базе, ни в открытой базе Open Food Facts.
          ${user ? 'Добавьте его — после проверки администратором товар будут находить все.' : '<a href="login.html">Войдите</a>, чтобы добавить его в базу, или запишите продукт в <a href="diary.html">дневник</a> вручную.'}</p>
        ${user ? addForm(code) : ''}
      </div>`;
    if (user) bindAddForm(code);
  }

  function addForm(code) {
    const num = (id, label, req, max = 100) => `<div class="field"><label for="${id}">${label}${req ? ' *' : ''}</label>
      <input class="input" id="${id}" type="number" inputmode="decimal" min="0" max="${max}" step="0.1"${req ? ' required' : ''}></div>`;
    return `
      <form class="add-product" id="add-product" novalidate>
        <h3>Добавить товар</h3>
        <div class="form-grid">
          <div class="field" style="grid-column:1/-1"><label for="ap-name">Название *</label>
            <input class="input" id="ap-name" maxlength="120" required placeholder="Например: Кефир 1%"></div>
          <div class="field"><label for="ap-brand">Производитель</label><input class="input" id="ap-brand" maxlength="80" placeholder="Простоквашино"></div>
          <div class="field"><label for="ap-qty">Объём / вес</label><input class="input" id="ap-qty" maxlength="40" placeholder="900 мл"></div>
        </div>
        <p class="small muted" style="margin:14px 0 6px">Пищевая ценность на 100 г (или 100 мл) — как на упаковке:</p>
        <div class="form-grid nutri-inputs">
          ${num('ap-kcal', 'Ккал', true, 950)}${num('ap-p', 'Белки, г', true)}${num('ap-f', 'Жиры, г', true)}${num('ap-c', 'Углеводы, г', true)}
          ${num('ap-sugar', 'В т. ч. сахар, г')}${num('ap-salt', 'Соль, г')}
        </div>
        <div class="field" style="margin-top:14px"><label for="ap-ingr">Состав</label>
          <textarea class="textarea" id="ap-ingr" maxlength="3000" style="min-height:80px" placeholder="Можно не заполнять"></textarea></div>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="ap-drink"> Это напиток</label>
        <p class="small muted" style="margin:16px 0 6px">Два фото — по ним администратор проверит, что товар настоящий:</p>
        <div class="photo-picks">
          <label class="photo-pick" for="ap-photo-front">
            <input type="file" id="ap-photo-front" accept="image/jpeg,image/png,image/webp" class="sr-only">
            <span class="photo-pick-img" id="ap-photo-front-img">📷</span>
            <span><b>Лицевая сторона *</b><br><span class="small muted">название и бренд</span></span>
          </label>
          <label class="photo-pick" for="ap-photo-label">
            <input type="file" id="ap-photo-label" accept="image/jpeg,image/png,image/webp" class="sr-only">
            <span class="photo-pick-img" id="ap-photo-label-img">🧾</span>
            <span><b>Состав и штрихкод *</b><br><span class="small muted">таблица КБЖУ и цифры под штрихкодом</span></span>
          </label>
        </div>
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">Отправить на проверку</button>
      </form>`;
  }

  /* фото упаковки уменьшаем до 800 px — так оно весит около 100 КБ */
  function shrink(file, max = 800) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
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

  const kcalFromMacros = (x) => 4 * (x.protein || 0) + 9 * (x.fat || 0) + 4 * (x.carbs || 0);
  /* допускаем расхождение до 20 % (не меньше 25 ккал): клетчатка, сахарозаменители и округление на упаковке */
  const kcalMismatch = (kcal, est) => Math.abs(kcal - est) > Math.max(25, est * 0.2);

  function bindAddForm(code) {
    const form = document.getElementById('add-product');
    const $ = (id) => form.querySelector('#' + id);
    const photos = { front: null, label: null };
    form.addEventListener('input', (e) => {
      if (/^ap-(kcal|p|f|c)$/.test(e.target.id)) delete form.dataset.confirmed;
    });
    ['front', 'label'].forEach((kind) => {
      const input = $(`ap-photo-${kind}`);
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          // таблицу состава уменьшаем меньше — мелкий текст должен читаться
          photos[kind] = await shrink(file, kind === 'label' ? 1400 : 800);
          $(`ap-photo-${kind}-img`).innerHTML = `<img src="${URL.createObjectURL(photos[kind])}" alt="">`;
          input.closest('.photo-pick').classList.add('done');
          form.querySelector('.form-error').textContent = '';
        } catch (err) {
          photos[kind] = null;
          toast(err.message, 'error');
        }
      });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      const val = (id) => ($(id).value.trim() === '' ? null : Number($(id).value.replace(',', '.')));
      const fields = {
        barcode: code,
        name: $('ap-name').value.trim(),
        brand: $('ap-brand').value.trim() || null,
        quantity: $('ap-qty').value.trim() || null,
        kcal: val('ap-kcal'), protein: val('ap-p'), fat: val('ap-f'), carbs: val('ap-c'),
        sugars: val('ap-sugar'), salt: val('ap-salt'),
        ingredients: $('ap-ingr').value.trim() || null,
        is_drink: $('ap-drink').checked,
      };
      if (fields.name.length < 2) { err.textContent = 'Укажите название товара'; return; }
      if (!photos.front || !photos.label) { err.textContent = 'Приложите оба фото: лицевую сторону и сторону с составом и штрихкодом'; return; }
      const bad = [['kcal', 950], ['protein', 100], ['fat', 100], ['carbs', 100], ['sugars', 100], ['salt', 100]]
        .find(([k, max]) => (k === 'kcal' || k === 'protein' || k === 'fat' || k === 'carbs' || fields[k] != null) && !(fields[k] >= 0 && fields[k] <= max));
      if (bad) { err.textContent = 'Проверьте КБЖУ: калории от 0 до 950, белки, жиры и углеводы от 0 до 100 г'; return; }
      if (fields.protein + fields.fat + fields.carbs > 100) { err.textContent = 'Белков, жиров и углеводов вместе не может быть больше 100 г на 100 г'; return; }
      // калории должны примерно сходиться с БЖУ: 4 ккал на грамм белка и углеводов, 9 — на грамм жира
      const est = kcalFromMacros(fields);
      if (kcalMismatch(fields.kcal, est) && !form.dataset.confirmed) {
        err.innerHTML = `⚠️ Калории не сходятся с БЖУ: по белкам, жирам и углеводам выходит около <b>${Math.round(est)} ккал</b>, а указано <b>${fields.kcal}</b>.
          Проверьте цифры на упаковке. Если всё верно, нажмите «Отправить» ещё раз.`;
        form.dataset.confirmed = '1';
        return;
      }
      if (!(await DB.checkText([fields.name, fields.brand, fields.ingredients].filter(Boolean).join(' ')))) {
        err.textContent = 'Текст содержит недопустимые слова';
        return;
      }
      err.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = '⏳ Отправляем…';
      try {
        await DB.products.submit(fields, photos);
        productEl.innerHTML = `<div class="card"><h3>✅ Спасибо!</h3><p class="muted">Товар «${esc(fields.name)}» отправлен на проверку. Когда администратор его одобрит, он будет находиться по штрихкоду ${esc(code)} у всех.</p></div>`;
      } catch (error) {
        err.textContent = /product_requests|schema cache/i.test(error.message)
          ? 'Добавление товаров ещё не подключено: выполните в Supabase файл schema-8-products.sql'
          : error.message;
        btn.disabled = false;
        btn.textContent = 'Отправить на проверку';
      }
    });
  }

  const productName = (p) => p.product_name_ru || p.product_name || 'Без названия';

  /* светофор по нормам Агентства пищевых стандартов Великобритании, на 100 г / 100 мл */
  const LIMITS = {
    food: { fat: [3, 17.5], 'saturated-fat': [1.5, 5], sugars: [5, 22.5], salt: [0.3, 1.5] },
    drink: { fat: [1.5, 8.75], 'saturated-fat': [0.75, 2.5], sugars: [2.5, 11.25], salt: [0.3, 0.75] },
  };
  const LIGHT_NAMES = { fat: 'Жиры', 'saturated-fat': 'Насыщенные жиры', sugars: 'Сахар', salt: 'Соль' };
  const LIGHT_COLORS = { low: '#3c8a3f', mid: '#e8a33c', high: '#d9483b' };
  const LIGHT_TEXT = { low: 'мало', mid: 'умеренно', high: 'много' };

  const NOVA = {
    1: 'Необработанный или минимально обработанный продукт',
    2: 'Кулинарный ингредиент',
    3: 'Обработанный продукт',
    4: 'Ультраобработанный продукт — лучше ограничивать',
  };

  const CATEGORY_SWAPS = [
    [/energy-drinks/, 'energy'],
    [/burgers|hamburgers/, 'burger'],
    [/pizzas/, 'pizza'],
    [/breakfast-cereals|cereals/, 'cereal'],
    [/ice-creams/, 'icecream'],
    [/croissants/, 'croissant'],
    [/ketchup/, 'ketchup'],
    [/popcorn/, 'popcorn'],
    [/crackers|croutons|rusks/, 'crackers'],
    [/chocolate-bars|candy-bars/, 'chocobar'],
    [/biscuits|cookies/, 'cookies'],
    [/dumplings|pelmeni/, 'dumplings'],
    [/nuggets/, 'nuggets'],
    [/white-breads|sliced-breads/, 'whitebread'],
    [/sodas|soft-drinks|colas|carbonated-drinks|sweetened-beverages/, 'cola'],
    [/french-fries/, 'fries'],
    [/chips|crisps/, 'chips'],
    [/chocolate|spreads|hazelnut/, 'choc'],
    [/yogurts|yoghurts/, 'yogurt'],
    [/sausages|frankfurters/, 'sausage'],
    [/mayonnaise/, 'mayo'],
    [/donuts|doughnuts|pastries|cakes|biscuits|cookies|viennoiseries|sweet-snacks/, 'donut'],
    [/juices|nectars/, 'juice'],
    [/instant-noodles|noodles/, 'noodles'],
  ];

  function renderProduct(code, p, source) {
    const n = p.nutriments || {};
    const num = (key) => (n[key + '_100g'] != null && n[key + '_100g'] !== '' ? Number(n[key + '_100g']) : null);
    const cats = (p.categories_tags || []).join(' ');
    const isDrink = /beverages|drinks/.test(cats);
    const unit = isDrink ? '100 мл' : '100 г';
    const kcal = num('energy-kcal') ?? (num('energy') != null ? num('energy') / 4.184 : null);

    const lights = Object.keys(LIGHT_NAMES).map((key) => {
      const v = num(key);
      if (v == null) return null;
      const [lo, hi] = LIMITS[isDrink ? 'drink' : 'food'][key];
      const level = v <= lo ? 'low' : v > hi ? 'high' : 'mid';
      return { key, v, level };
    }).filter(Boolean);
    const reds = lights.filter((l) => l.level === 'high').length;

    const grade = (p.nutriscore_grade || '').toLowerCase();
    const verdict = /^[ab]$/.test(grade) || (!grade && reds === 0 && lights.length)
      ? ['good', '👍 Хороший выбор для повседневного рациона.']
      : /^[de]$/.test(grade) || reds >= 2
        ? ['bad', '⚠️ Лучше есть редко и небольшими порциями.']
        : ['mid', '🙂 Подходит в умеренных количествах.'];

    const swapId = (CATEGORY_SWAPS.find(([re]) => re.test(cats)) || [])[1];
    const swap = window.SWAPS.find((s) => s.id === swapId);
    const advice = [];
    if (swap && verdict[0] !== 'good') {
      advice.push(`Полезная замена: <b>${swap.good.emoji} ${esc(swap.good.name)}</b>. ${esc(swap.tip)}`);
    }
    lights.filter((l) => l.level === 'high').forEach((l) => {
      advice.push({
        sugars: 'Много сахара — ищите вариант без добавленного сахара или замените на фрукты и ягоды.',
        salt: 'Много соли — выбирайте продукты с пометкой «с пониженным содержанием соли» и не досаливайте блюда.',
        fat: 'Много жира — посмотрите облегчённую версию или уменьшите порцию.',
        'saturated-fat': 'Много насыщенных жиров — их лучше заменять растительными маслами, орехами и рыбой.',
      }[l.key]);
    });

    const additives = (p.additives_tags || []).map((t) => t.replace(/^en:/, '').toUpperCase());
    const ingredients = p.ingredients_text_ru || p.ingredients_text;
    const rows = [
      ['Калории', kcal, 'ккал'], ['Белки', num('proteins'), 'г'], ['Жиры', num('fat'), 'г'],
      ['в т. ч. насыщенные', num('saturated-fat'), 'г'], ['Углеводы', num('carbohydrates'), 'г'],
      ['в т. ч. сахар', num('sugars'), 'г'], ['Клетчатка', num('fiber'), 'г'], ['Соль', num('salt'), 'г'],
    ].filter(([, v]) => v != null);
    const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');

    productEl.innerHTML = `
      <div class="card">
        <div class="product-head">
          ${p.image_front_small_url ? `<img src="${esc(p.image_front_small_url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot; aria-hidden=&quot;true&quot;>🛒</div>'">` : '<div class="ph" aria-hidden="true">🛒</div>'}
          <div>
            <h2 style="font-size:1.4rem;margin-bottom:4px">${esc(productName(p))}</h2>
            <div class="muted">${esc([p.brands, p.quantity].filter(Boolean).join(' · '))}</div>
            <div class="small muted">Штрихкод ${esc(code)}${(() => { const c = BARCODE.country(code); return c ? ` · ${c.flag} код выдан: ${esc(c.name)}` : ''; })()}${source === 'user' ? ' · добавлен участниками «Вкус здоровья»' : ''}</div>
          </div>
        </div>

        <div class="score-row">
          ${grade && /^[a-e]$/.test(grade) ? `<div><div class="small muted">Nutri-Score</div><div class="nutriscore" aria-label="Nutri-Score ${grade.toUpperCase()}">
            ${['a', 'b', 'c', 'd', 'e'].map((g, i) => `<span class="${g === grade ? 'on' : ''}" style="background:${['#038141', '#85bb2f', '#fecb02', '#ee8100', '#e63e11'][i]}">${g.toUpperCase()}</span>`).join('')}
          </div></div>` : ''}
          ${p.nova_group ? `<div style="flex:1;min-width:200px"><div class="small muted">Степень обработки (NOVA ${p.nova_group})</div><b>${NOVA[p.nova_group] || ''}</b></div>` : ''}
        </div>

        <div class="verdict ${verdict[0]}">${verdict[1]}</div>

        ${lights.length ? `<h3>На ${unit}</h3><div class="lights">${lights.map((l) => `
          <div class="light"><i style="background:${LIGHT_COLORS[l.level]}"></i><span>${LIGHT_NAMES[l.key]} — ${LIGHT_TEXT[l.level]}</span><b>${fmt(l.v)} г</b></div>`).join('')}</div>` : ''}

        ${advice.length ? `<ul class="tips">${advice.map((a) => `<li><span>${a}</span></li>`).join('')}</ul>` : ''}

        ${rows.length ? `<h3>Пищевая ценность на ${unit}</h3>
          <div class="table-wrap"><table class="table">${rows.map(([name, v, u]) => `<tr><td>${name}</td><td style="text-align:right"><b>${fmt(v)}</b> ${u}</td></tr>`).join('')}</table></div>` : '<p class="muted">Производитель не указал пищевую ценность.</p>'}

        ${additives.length ? `<h3 style="margin-top:20px">Пищевые добавки (${additives.length})</h3><div class="tags">${additives.map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>` : ''}
        ${ingredients ? `<h3 style="margin-top:20px">Состав</h3><p class="ingr-text">${esc(ingredients)}</p>` : ''}

        ${kcal != null ? `
          <h3 style="margin-top:20px">Записать в дневник</h3>
          <form class="inline-form" id="to-diary" novalidate>
            <div class="field"><label for="sd-grams">Сколько, ${isDrink ? 'мл' : 'г'}</label>
              <input class="input" id="sd-grams" type="number" min="1" max="5000" value="100"></div>
            <div class="field"><label for="sd-meal">Приём пищи</label>
              <select class="select" id="sd-meal">${Object.entries(window.MEAL_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <button class="btn btn-primary" type="submit">В дневник</button>
          </form>` : ''}
      </div>`;

    const form = document.getElementById('to-diary');
    if (form) {
      const hour = new Date().getHours();
      form.querySelector('#sd-meal').value = hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const g = Number(form.querySelector('#sd-grams').value);
        if (!(g > 0 && g <= 5000)) return;
        const k = g / 100;
        const d = new Date();
        try {
          await DB.diary.add({
            date: new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
            meal: form.querySelector('#sd-meal').value,
            name: [productName(p), p.brands && p.brands.split(',')[0]].filter(Boolean).join(', ').slice(0, 200),
            grams: g,
            kcal: Math.round(kcal * k),
            protein: +((num('proteins') || 0) * k).toFixed(1),
            fat: +((num('fat') || 0) * k).toFixed(1),
            carbs: +((num('carbohydrates') || 0) * k).toFixed(1),
          });
          toast('Записано в дневник питания');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    productEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ===================== История сканирований ===================== */

  function remember(code, name) {
    const list = DB.store.get('scans', []).filter((s) => s.code !== code);
    list.unshift({ code, name });
    DB.store.set('scans', list.slice(0, 8));
    renderRecent();
  }

  function renderRecent() {
    const list = DB.store.get('scans', []);
    const box = document.getElementById('recent');
    box.classList.toggle('hidden', !list.length);
    box.innerHTML = '<span class="small muted" style="align-self:center">Недавние:</span>' +
      list.map((s) => `<button type="button" class="chip" data-code="${esc(s.code)}">${esc(s.name.slice(0, 30))}</button>`).join('');
  }

  camBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  document.getElementById('code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup(document.getElementById('code').value);
  });
  document.querySelectorAll('#examples, #recent').forEach((box) => box.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-code]');
    if (!chip) return;
    document.getElementById('code').value = chip.dataset.code;
    lookup(chip.dataset.code);
  }));
  window.addEventListener('pagehide', stopCamera);

  renderRecent();
  const fromUrl = new URLSearchParams(location.search).get('code');
  if (fromUrl) lookup(fromUrl);
})();
