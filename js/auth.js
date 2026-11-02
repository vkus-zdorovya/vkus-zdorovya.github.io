/* Вход, регистрация, выбор плана, восстановление пароля */
(function () {
  const { toast, userReady } = window.UI;
  const STEPS = ['login', 'register', 'confirm', 'plan', 'recovery'];
  let user = null;
  let recovering = /type=recovery/.test(location.hash);

  function show(step) {
    if (!STEPS.includes(step)) step = 'login';
    if (step === 'confirm' && !pendingEmail()) step = 'register';
    if (step === 'confirm') {
      document.getElementById('confirm-email').textContent = pendingEmail();
      fillConfirmTexts();
    }
    if (step === 'plan' && !user) {
      toast('Сначала войдите или зарегистрируйтесь', 'error');
      step = 'login';
    }
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== step));
    document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', s.dataset.step === step));
    document.title = { login: 'Вход в аккаунт', register: 'Регистрация', confirm: 'Подтверждение почты', plan: 'Выбор плана', recovery: 'Новый пароль' }[step] + ' — ВкусЗдоровья';

    if (step === 'plan') document.getElementById('plan-current').textContent = user.plan === 'personal' ? 'Персональный' : 'Базовый';
  }

  const route = () => {
    const hash = location.hash.slice(1);
    const step = /access_token|error_description/.test(hash) ? '' : hash;
    if (/error_description/.test(hash)) toast('Ссылка из письма устарела или уже использована. Войдите или запросите новое письмо.', 'error');
    show(recovering ? 'recovery' : step || (user ? 'plan' : 'login'));
  };
  window.addEventListener('hashchange', route);

  /* показать / скрыть пароль */
  document.querySelectorAll('[data-eye]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      btn.setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
    });
  });

  /* ---------- проверка адреса почты ---------- */

  const DISPOSABLE = new Set([
    'mailinator.com', 'yopmail.com', 'yopmail.fr', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'temp-mail.io',
    'tempmail.com', 'tempmail.net', 'tempmail.plus', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
    'trashmail.com', 'trashmail.de', 'dropmail.me', 'getnada.com', 'maildrop.cc', 'moakt.com', 'emailondeck.com',
    'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', '1secmail.com', '1secmail.org', 'tempail.com', 'mail.tm',
    'mailnesia.com', 'mintemail.com', 'spamgourmet.com', 'emailfake.com', 'generator.email', 'tempr.email',
    'discard.email', 'mailcatch.com', 'inboxkitten.com', 'burnermail.io', 'mytemp.email', 'tmpmail.org', 'tmpmail.net',
  ]);
  const TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.ru': 'gmail.com', 'gamil.com': 'gmail.com',
    'yandex.r': 'yandex.ru', 'yandeks.ru': 'yandex.ru', 'yadex.ru': 'yandex.ru', 'yndex.ru': 'yandex.ru',
    'mail.r': 'mail.ru', 'mial.ru': 'mail.ru', 'maill.ru': 'mail.ru', 'mail.com.ru': 'mail.ru',
  };
  const DNS = window.APP_CONFIG.useProxy ? location.origin + '/dns' : 'https://dns.google';

  /* возвращает текст ошибки или '' — если адрес выглядит настоящим */
  async function checkEmail(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Некорректный адрес почты';
    const domain = email.split('@')[1].toLowerCase();
    if (TYPOS[domain]) return `Возможно, опечатка: имелось в виду …@${TYPOS[domain]}?`;
    if (DISPOSABLE.has(domain)) return 'Одноразовые почтовые ящики не принимаются — укажите свою постоянную почту';
    try {
      const ask = async (type) => {
        const res = await fetch(`${DNS}/resolve?name=${encodeURIComponent(domain)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
        if (!res.ok) throw new Error('dns');
        return res.json();
      };
      const mx = await ask('MX');
      if (mx.Status === 3) return `Почтового домена «${domain}» не существует — проверьте адрес`;
      const hasMx = (mx.Answer || []).some((r) => r.type === 15 && !/^0 \.$/.test(r.data));
      if (!hasMx) {
        const a = await ask('A');
        if (!(a.Answer || []).length) return `На домене «${domain}» нет почты — проверьте адрес`;
      }
    } catch {
      // сервис проверки недоступен — не мешаем регистрации, письмо с подтверждением всё равно проверит адрес
    }
    return '';
  }

  /*
   * Ожидающий код: { email, mode, remember }
   *   mode 'signup' — подтверждение почты после регистрации
   *   mode 'login'  — код при входе в аккаунт
   */
  const pending = () => DB.store.get('pending_code', null) || {};
  const pendingEmail = () => pending().email || '';
  function askForCode(email, mode = 'signup', remember = true) {
    DB.store.set('pending_code', { email, mode, remember });
    if (location.hash === '#confirm') show('confirm');
    else location.hash = 'confirm';
  }
  function fillConfirmTexts() {
    const login = pending().mode === 'login';
    document.getElementById('confirm-title').textContent = login ? 'Код для входа' : 'Подтвердите почту';
    document.getElementById('confirm-lead').textContent = login
      ? 'Введите его ниже, чтобы войти в аккаунт.'
      : 'Введите его ниже — так мы убедимся, что почта настоящая.';
    const back = document.getElementById('confirm-back');
    back.href = login ? '#login' : '#register';
    back.textContent = login ? 'Войти с другой почтой' : 'Изменить почту';
  }

  function lock(form, locked) {
    form.querySelector('button[type="submit"]').disabled = locked;
  }

  /* ---------- вход ---------- */
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = loginForm.querySelector('.form-error');
    err.textContent = '';
    lock(loginForm, true);
    const email = loginForm.email.value.trim();
    const remember = loginForm.remember.checked;
    try {
      const result = await DB.auth.signIn({ email, password: loginForm.password.value, remember });
      if (result && result.needsCode) {
        lock(loginForm, false);
        toast('Код для входа отправлен на почту');
        askForCode(email, 'login', remember);
        return;
      }
      toast('С возвращением!');
      location.href = 'diet.html';
    } catch (error) {
      err.textContent = error.message;
      if (/не подтверждена/.test(error.message)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-btn';
        btn.textContent = 'Ввести код';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', async () => {
          try {
            await DB.auth.resendConfirmation(email);
          } catch (e2) {
            toast(e2.message, 'error');
          }
          askForCode(email, 'signup');
        });
        err.appendChild(btn);
      }
      lock(loginForm, false);
    }
  });

  document.getElementById('forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const err = loginForm.querySelector('.form-error');
    if (!email) {
      err.textContent = 'Введите почту в поле выше — пришлём ссылку для восстановления';
      loginForm.email.focus();
      return;
    }
    try {
      await DB.auth.resetPassword(email);
      toast('Письмо со ссылкой для смены пароля отправлено');
    } catch (error) {
      err.textContent = error.message;
    }
  });

  /* ---------- регистрация ---------- */
  const regForm = document.getElementById('register-form');
  const meter = document.getElementById('pass-meter');
  const hint = document.getElementById('pass-hint');

  regForm.password.addEventListener('input', () => {
    const v = regForm.password.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^\wА-Яа-я]/.test(v)) score++;
    const levels = [['#d9483b', 'Слишком короткий'], ['#d9483b', 'Слабый'], ['#e8a33c', 'Средний'], ['#9bc53d', 'Хороший'], ['#3c8a3f', 'Надёжный'], ['#3c8a3f', 'Очень надёжный']];
    meter.style.width = v ? (Math.max(1, score) / 5) * 100 + '%' : '0';
    meter.style.background = levels[score][0];
    hint.textContent = v ? levels[score][1] : '';
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = regForm.querySelector('.form-error');
    const name = regForm.name.value.trim();
    if (!name) { err.textContent = 'Укажите имя'; return; }
    if (regForm.password.value !== regForm.password2.value) { err.textContent = 'Пароли не совпадают'; return; }
    if (!regForm.agree.checked) { err.textContent = 'Нужно согласие на обработку персональных данных'; return; }
    err.textContent = '';
    lock(regForm, true);
    const email = regForm.email.value.trim();
    const problem = await checkEmail(email);
    if (problem) {
      err.textContent = problem;
      regForm.email.classList.add('invalid');
      lock(regForm, false);
      return;
    }
    regForm.email.classList.remove('invalid');
    try {
      const { needsConfirm } = await DB.auth.signUp({ name, email, password: regForm.password.value });
      if (needsConfirm) {
        lock(regForm, false);
        askForCode(email);
        return;
      }
      // перезагрузка обновит шапку и откроет шаг выбора плана
      location.hash = 'plan';
      location.reload();
    } catch (error) {
      err.textContent = error.message;
      lock(regForm, false);
    }
  });

  /* ---------- выбор плана ---------- */
  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan;
      btn.disabled = true;
      try {
        await DB.auth.updatePlan(plan);
        user.plan = plan;
        if (plan === 'personal') {
          await DB.contact.send({ name: user.name, email: user.email, message: 'Заявка на персональный план' });
          toast('Заявка принята! Нутрициолог свяжется с вами по почте.');
          show('plan');
        } else {
          toast('Готово! Начнём с расчёта нормы калорий.');
          location.href = 'calculator.html';
        }
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  /* ---------- новый пароль по ссылке из письма ---------- */
  DB.auth.onPasswordRecovery(() => {
    recovering = true;
    show('recovery');
  });
  const recForm = document.getElementById('recovery-form');
  recForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = recForm.querySelector('.form-error');
    lock(recForm, true);
    try {
      await DB.auth.updatePassword(recForm.password.value);
      toast('Пароль изменён');
      location.href = 'diet.html';
    } catch (error) {
      err.textContent = error.message;
      lock(recForm, false);
    }
  });

  /* ---------- код подтверждения ---------- */
  const confirmForm = document.getElementById('confirm-form');
  confirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = confirmForm.querySelector('.form-error');
    const code = confirmForm.code.value.replace(/\D/g, '');
    if (code.length < 6) {
      err.textContent = 'Введите код из письма — 6 цифр';
      return;
    }
    err.textContent = '';
    lock(confirmForm, true);
    try {
      const { email, mode, remember } = pending();
      if (mode === 'login') {
        await DB.auth.verifyLoginCode(email, code, remember !== false);
        DB.store.remove('pending_code');
        toast('С возвращением!');
        location.href = 'diet.html';
        return;
      }
      await DB.auth.verifySignupCode(email, code);
      DB.store.remove('pending_code');
      location.hash = 'plan';
      location.reload();
    } catch (error) {
      err.textContent = error.message;
      lock(confirmForm, false);
    }
  });
  confirmForm.code.addEventListener('input', () => {
    confirmForm.code.value = confirmForm.code.value.replace(/\D/g, '');
  });
  document.getElementById('resend-code').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (pending().mode === 'login') await DB.auth.resendLoginCode(pendingEmail());
      else await DB.auth.resendConfirmation(pendingEmail());
      toast('Новый код отправлен — проверьте почту и папку «Спам»');
    } catch (error) {
      toast(error.message, 'error');
    }
    setTimeout(() => { btn.disabled = false; }, 60000);
  });

  userReady.then((u) => {
    user = u;
    route();
  });
})();
