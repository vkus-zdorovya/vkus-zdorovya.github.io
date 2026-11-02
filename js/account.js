/* Личный кабинет: профиль, дневник веса с графиком, история расчётов, настройки */
(function () {
  const { esc, toast, formatDate, userReady } = window.UI;
  const store = DB.store;
  const today = (() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00').toLocaleDateString('ru-RU', opts);
  const GOAL_NAMES = { lose: 'Похудеть', maintain: 'Поддерживать', gain: 'Набрать' };

  /* ---------- профиль ---------- */

  function renderProfile(user) {
    const box = document.getElementById('profile');
    if (!user) {
      box.innerHTML = `
        <h2 style="font-size:1.5rem">Вы не вошли в аккаунт</h2>
        <p class="muted">Кабинетом можно пользоваться и так — данные сохранятся в этом браузере. Войдите, чтобы они были доступны с телефона и компьютера.</p>
        <div class="hero-actions" style="margin-top:12px">
          <a class="btn btn-primary" href="login.html">Войти</a>
          <a class="btn btn-ghost" href="login.html#register">Зарегистрироваться</a>
        </div>`;
      return;
    }
    box.innerHTML = `
      <div class="profile-banner" id="banner-preview">${(user.banner_pending_url || user.banner_url) ? `<img src="${esc(user.banner_pending_url || user.banner_url)}" alt="Баннер профиля">` : ''}${user.banner_pending_url ? '<span class="pending-badge">⏳ на проверке</span>' : ''}</div>
      <div class="profile-row">
        <span id="avatar-preview">${UI.avatarHtml(user.name, user.avatar_pending_url || user.avatar_url, 'avatar-lg')}</span>
        <div>
          <h2 style="font-size:1.5rem;margin-bottom:4px">${esc(user.name)}</h2>
          <div class="muted">${esc(user.email)}</div>
          <p class="small muted" id="avatar-status" style="margin:8px 0 0">${[
            user.avatar_pending ? '⏳ Новое фото на проверке у администратора' : '',
            user.banner_pending ? '⏳ Новый баннер на проверке у администратора' : '',
          ].filter(Boolean).join('<br>')}</p>
          ${user.muted_until && new Date(user.muted_until) > new Date() ? `<p class="small" style="color:var(--danger);margin:6px 0 0">🔇 Мут до ${esc(new Date(user.muted_until).toLocaleString('ru-RU'))}</p>` : ''}
          <a class="small" href="profile.html?id=${encodeURIComponent(user.id)}">Мой публичный профиль →</a>
          <a class="small" href="messages.html" style="margin-left:12px">✉️ Личные сообщения</a>
        </div>
        <button class="btn btn-danger btn-sm" type="button" id="logout2">Выйти</button>
      </div>

      <div class="account-grid" style="margin-top:24px">
        <form class="inline-form" id="name-form" novalidate>
          <div class="field">
            <label for="nick">Ник (имя на сайте и форуме)</label>
            <input class="input" id="nick" maxlength="40" value="${esc(user.name)}" required>
          </div>
          <button class="btn btn-primary" type="submit">Сохранить</button>
        </form>

        <div class="field">
          <span class="label">Фото профиля</span>
          <div class="inline-form">
            <label class="btn btn-ghost" for="avatar-file" style="cursor:pointer">📷 Выбрать фото</label>
            <input type="file" id="avatar-file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only">
            ${(user.avatar_url || user.avatar_pending) ? '<button class="btn btn-ghost" type="button" data-remove="avatar">Удалить фото</button>' : ''}
          </div>
          <span class="small muted">JPG, PNG, WebP или GIF (до 2 МБ). ${user.role === 'admin' ? 'Вы администратор — фото появится сразу.' : 'Отправляется на проверку сразу после выбора и появится после одобрения.'}</span>
        </div>

        <div class="field">
          <span class="label">Баннер профиля</span>
          <div class="inline-form">
            <label class="btn btn-ghost" for="banner-file" style="cursor:pointer">🖼 Выбрать баннер</label>
            <input type="file" id="banner-file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only">
            ${(user.banner_url || user.banner_pending) ? '<button class="btn btn-ghost" type="button" data-remove="banner">Удалить баннер</button>' : ''}
          </div>
          <span class="small muted">Широкая картинка вверху профиля в пропорции 4:1, лучше 2400×600 — края по бокам обрежутся автоматически. Можно GIF до 5 МБ. ${user.role === 'admin' ? 'Появится сразу.' : 'Тоже проходит проверку.'}</span>
        </div>
      </div>`;

    box.querySelector('#logout2').addEventListener('click', async () => {
      await DB.auth.signOut();
      location.reload();
    });

    box.querySelector('#name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = box.querySelector('#nick').value.trim();
      if (name.length < 2) {
        toast('Ник должен быть не короче 2 символов', 'error');
        return;
      }
      if (!(await DB.checkText(name))) {
        toast('Ник содержит недопустимые слова', 'error');
        return;
      }
      try {
        await DB.profile.updateName(name);
        toast('Ник сохранён');
        setTimeout(() => location.reload(), 600);
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    /* фото / баннер отправляется сразу после выбора; GIF загружается как есть, чтобы сохранить анимацию */
    const LIMITS = { avatar: 2, banner: 5 };
    ['avatar', 'banner'].forEach((kind) => {
      const input = box.querySelector(`#${kind}-file`);
      const label = box.querySelector(`label[for="${kind}-file"]`);
      input.addEventListener('change', async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
          toast('Подходят только JPG, PNG, WebP или GIF', 'error');
          return;
        }
        if (file.type === 'image/gif' && file.size > LIMITS[kind] * 1024 * 1024) {
          toast(`GIF слишком большой — максимум ${LIMITS[kind]} МБ`, 'error');
          return;
        }
        const labelText = label.textContent;
        label.textContent = '⏳ Загружаем…';
        label.style.pointerEvents = 'none';
        try {
          const blob = file.type === 'image/gif'
            ? file
            : await cropImage(file, kind === 'avatar' ? 512 : 2400, kind === 'avatar' ? 512 : 600);
          const result = await DB.profile.requestMedia(kind, blob);
          if (result === 'approved') {
            toast(kind === 'avatar' ? 'Фото обновлено' : 'Баннер обновлён');
            setTimeout(() => location.reload(), 600);
            return;
          }
          const url = URL.createObjectURL(blob);
          if (kind === 'avatar') {
            box.querySelector('#avatar-preview').innerHTML = `<span class="avatar avatar-lg"><img src="${url}" alt="Новое фото"></span>`;
          } else {
            box.querySelector('#banner-preview').innerHTML = `<img src="${url}" alt="Новый баннер"><span class="pending-badge">⏳ на проверке</span>`;
          }
          const status = box.querySelector('#avatar-status');
          const line = `⏳ ${kind === 'avatar' ? 'Новое фото' : 'Новый баннер'} на проверке у администратора`;
          if (!status.textContent.includes(line.slice(2))) status.innerHTML += `${status.innerHTML.trim() ? '<br>' : ''}${line}`;
          toast(kind === 'avatar' ? 'Фото отправлено на проверку' : 'Баннер отправлен на проверку');
        } catch (error) {
          toast(error.message || 'Не удалось загрузить изображение', 'error');
        } finally {
          label.textContent = labelText;
          label.style.pointerEvents = '';
        }
      });
    });

    box.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.remove;
        if (!confirm(kind === 'avatar' ? 'Удалить фото профиля?' : 'Удалить баннер?')) return;
        try {
          await DB.profile.removeMedia(kind);
          location.reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  /* обрезаем картинку под нужные пропорции; маленькие картинки не растягиваем, чтобы не было мыла */
  function cropImage(file, maxWidth, maxHeight) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ratio = maxWidth / maxHeight;
        // самый большой кусок нужной пропорции из центра картинки
        let sw = img.width;
        let sh = sw / ratio;
        if (sh > img.height) { sh = img.height; sw = sh * ratio; }
        const width = Math.round(Math.min(maxWidth, sw));
        const height = Math.round(width / ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, width, height);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas'))), 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }



  /* ---------- вес ---------- */

  const wForm = document.getElementById('weight-form');
  wForm.date.value = today;
  wForm.date.max = today;
  const lastBody = store.get('body', {});
  if (lastBody.weight) wForm.weight.placeholder = String(lastBody.weight).replace('.', ',');

  async function loadWeights() {
    let rows = [];
    try {
      rows = (await DB.weights.list()).map((r) => ({ ...r, weight: Number(r.weight) }));
    } catch (err) {
      document.getElementById('w-chart').innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
      return;
    }
    renderWeightStats(rows);
    renderWeightChart(rows);
    document.getElementById('w-table').innerHTML = rows.length
      ? '<tr><th>Дата</th><th>Вес</th><th></th></tr>' + rows.slice().reverse().map((r) => `
          <tr><td>${fmtDate(r.date, { day: 'numeric', month: 'long', year: 'numeric' })}</td><td>${r.weight.toLocaleString('ru-RU')} кг</td>
          <td style="text-align:right"><button class="icon-btn" type="button" data-wdel="${r.id}" aria-label="Удалить">✕</button></td></tr>`).join('')
      : '<tr><td class="muted">Записей пока нет</td></tr>';
  }

  function renderWeightStats(rows) {
    const box = document.getElementById('w-stats');
    if (!rows.length) { box.innerHTML = ''; return; }
    const first = rows[0].weight;
    const last = rows[rows.length - 1].weight;
    const diff = +(last - first).toFixed(1);
    const height = lastBody.height;
    const bmi = height ? last / (height / 100) ** 2 : null;
    box.innerHTML = `
      <div class="stat"><div class="stat-label">Сейчас</div><div class="stat-value">${last.toLocaleString('ru-RU')} <small>кг</small></div>
        <div class="stat-note muted">${fmtDate(rows[rows.length - 1].date, { day: 'numeric', month: 'long' })}</div></div>
      <div class="stat"><div class="stat-label">Изменение с начала</div>
        <div class="stat-value">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff).toLocaleString('ru-RU')} <small>кг</small></div>
        <div class="stat-note muted">с ${fmtDate(rows[0].date, { day: 'numeric', month: 'long' })}</div></div>
      <div class="stat"><div class="stat-label">ИМТ</div><div class="stat-value">${bmi ? bmi.toFixed(1).replace('.', ',') : '—'}</div>
        <div class="stat-note" style="color:${bmi ? window.bmiCategory(bmi).color : 'inherit'}">${bmi ? window.bmiCategory(bmi).label : '<a href="calculator.html">укажите рост</a>'}</div></div>`;
  }

  function renderWeightChart(rows) {
    const box = document.getElementById('w-chart');
    if (rows.length < 2) {
      box.innerHTML = '<div class="chart-empty">📈 Добавьте хотя бы две записи веса — здесь появится график динамики.</div>';
      return;
    }
    const W = 640, H = 240, L = 44, R = 12, T = 12, B = 28;
    const t0 = new Date(rows[0].date).getTime();
    const t1 = new Date(rows[rows.length - 1].date).getTime();
    const values = rows.map((r) => r.weight);
    const height = lastBody.height;
    const band = height ? [18.5 * (height / 100) ** 2, 24.9 * (height / 100) ** 2] : null;
    let lo = Math.min(...values) - 1;
    let hi = Math.max(...values) + 1;
    // полосу нормы показываем только в пределах графика, чтобы линия веса не «сплющивалась»
    const x = (date) => L + ((new Date(date).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    const path = rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)} ${y(r.weight).toFixed(1)}`).join(' ');
    const area = `${path} L${x(rows[rows.length - 1].date).toFixed(1)} ${H - B} L${L} ${H - B} Z`;

    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График веса: от ${values[0]} до ${values[values.length - 1]} кг">
        <defs><linearGradient id="wg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6cbf6f" stop-opacity=".35"/><stop offset="1" stop-color="#6cbf6f" stop-opacity="0"/></linearGradient></defs>
        ${band ? `<rect x="${L}" width="${W - L - R}" y="${y(Math.min(band[1], hi))}" height="${Math.max(0, y(Math.max(band[0], lo)) - y(Math.min(band[1], hi)))}" fill="#6cbf6f" opacity=".12"/>` : ''}
        ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--field-line)"/>
          <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v.toFixed(1)}</text>`).join('')}
        <path d="${area}" fill="url(#wg)"/>
        <path d="${path}" fill="none" stroke="#3c8a3f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        ${rows.map((r) => `<circle cx="${x(r.date)}" cy="${y(r.weight)}" r="4.5" fill="var(--surface)" stroke="#3c8a3f" stroke-width="2.5"><title>${fmtDate(r.date)}: ${r.weight} кг</title></circle>`).join('')}
        <text x="${L}" y="${H - 6}" font-size="11" fill="var(--muted)">${fmtDate(rows[0].date)}</text>
        <text x="${W - R}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="end">${fmtDate(rows[rows.length - 1].date)}</text>
      </svg>
      ${band && band[1] > lo && band[0] < hi ? '<p class="small muted" style="margin-top:6px">Зелёная полоса — нормальный вес для вашего роста.</p>' : ''}`;
  }

  wForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const weight = Number(String(wForm.weight.value).replace(',', '.'));
    if (!wForm.date.value || !(weight >= 20 && weight <= 400)) {
      wForm.weight.classList.add('invalid');
      return;
    }
    wForm.weight.classList.remove('invalid');
    try {
      await DB.weights.add({ date: wForm.date.value, weight });
      if (wForm.date.value === today) store.set('body', { ...store.get('body', {}), weight });
      wForm.weight.value = '';
      toast('Вес записан');
      loadWeights();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('w-table').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-wdel]');
    if (!del) return;
    await DB.weights.remove(del.dataset.wdel);
    loadWeights();
  });

  /* ---------- история расчётов ---------- */

  async function loadCalcs() {
    const box = document.getElementById('calcs');
    try {
      const rows = await DB.calcs.list();
      box.innerHTML = rows.length ? `
        <table class="table">
          <tr><th>Дата</th><th>ИМТ</th><th>Норма</th><th>Цель</th><th></th></tr>
          ${rows.map((r) => {
            const d = r.data;
            const cat = window.bmiCategory(d.bmi);
            return `<tr>
              <td>${formatDate(r.created_at)}</td>
              <td><b style="color:${cat.color}">${Number(d.bmi).toFixed(1).replace('.', ',')}</b></td>
              <td>${Number(d.kcal).toLocaleString('ru-RU')} ккал</td>
              <td>${GOAL_NAMES[d.goal] || ''}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-repeat="${r.id}">Открыть</button></td>
            </tr>`;
          }).join('')}
        </table>` : '<p class="muted">Расчётов пока нет. <a href="calculator.html">Рассчитайте ИМТ и норму калорий</a> — результат сохранится здесь.</p>';
      box.onclick = (e) => {
        const btn = e.target.closest('[data-repeat]');
        if (!btn) return;
        const d = rows.find((r) => String(r.id) === btn.dataset.repeat).data;
        store.set('body', { sex: d.sex, age: d.age, height: d.height, weight: d.weight, activity: d.activity, goal: d.goal });
        location.href = 'calculator.html';
      };
    } catch (err) {
      box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  /* ---------- настройки ---------- */

  const themeSelect = document.getElementById('theme-select');
  themeSelect.value = UI.theme();
  themeSelect.addEventListener('change', () => UI.setTheme(themeSelect.value));

  const rem = { ...UI.reminderDefaults, ...store.get('reminder', {}) };
  const remOn = document.getElementById('rem-on');
  const remEvery = document.getElementById('rem-every');
  const remFrom = document.getElementById('rem-from');
  const remTo = document.getElementById('rem-to');
  const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `<option value="${from + i}">${String(from + i).padStart(2, '0')}:00</option>`).join('');
  remFrom.innerHTML = hours(5, 14);
  remTo.innerHTML = hours(15, 23);
  remOn.checked = rem.on;
  remEvery.value = rem.every;
  remFrom.value = rem.from;
  remTo.value = rem.to;

  function remStatus() {
    const el = document.getElementById('rem-status');
    document.getElementById('rem-settings').classList.toggle('hidden', !remOn.checked);
    if (!('Notification' in window)) {
      el.textContent = UI.isIOS() ? 'На iPhone уведомления работают только в установленном приложении (iOS 16.4+).' : 'Браузер не поддерживает уведомления.';
      return;
    }
    if (Notification.permission === 'denied') {
      el.textContent = 'Уведомления запрещены в настройках браузера для этого сайта.';
      return;
    }
    const next = UI.scheduleReminder();
    el.textContent = next ? `Следующее: ${next.toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Выключены';
  }

  async function saveReminder() {
    if (remOn.checked && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        remOn.checked = false;
        toast('Без разрешения на уведомления напоминания не смогут приходить', 'error');
      }
    }
    store.set('reminder', { on: remOn.checked, every: Number(remEvery.value), from: Number(remFrom.value), to: Number(remTo.value) });
    remStatus();
  }

  [remOn, remEvery, remFrom, remTo].forEach((el) => el.addEventListener('change', saveReminder));
  document.getElementById('rem-test').addEventListener('click', async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    if ('Notification' in window && Notification.permission === 'granted') UI.notify('Пора выпить воды 💧', 'Так будут выглядеть напоминания.');
    else toast('Разрешите уведомления для этого сайта', 'error');
  });
  remStatus();

  const installBtn = document.getElementById('install-btn');
  function installStatus() {
    const el = document.getElementById('install-status');
    installBtn.classList.toggle('hidden', !UI.canInstall());
    if (UI.isStandalone()) el.textContent = '✅ Вы уже пользуетесь приложением.';
    else if (UI.canInstall()) el.textContent = 'Иконка появится на главном экране, сайт будет открываться как приложение.';
    else if (UI.isIOS()) el.textContent = 'В Safari нажмите «Поделиться» → «На экран „Домой“».';
    else el.textContent = 'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».';
  }
  installBtn.addEventListener('click', async () => {
    if (await UI.install()) toast('Готово!');
    installStatus();
  });
  document.addEventListener('installable', installStatus);
  installStatus();

  userReady.then((user) => {
    renderProfile(user);
    loadWeights();
    loadCalcs();
  });
})();
