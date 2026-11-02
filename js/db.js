/*
 * Слой данных сайта.
 * Если в js/config.js указаны ключи Supabase — работаем с настоящей базой.
 * Иначе включается демо-режим: всё хранится в localStorage этого браузера.
 * Остальной код сайта обращается только к window.DB и не знает, какой режим активен.
 */
(function () {
  const cfg = window.APP_CONFIG || {};
  const useSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const supabaseUrl = cfg.SUPABASE_PROXY && cfg.useProxy ? location.origin + cfg.SUPABASE_PROXY : cfg.SUPABASE_URL;
  const sb = useSupabase
    ? window.supabase.createClient(supabaseUrl, cfg.SUPABASE_ANON_KEY, { auth: { storageKey: 'ukropchik-auth' } })
    : null;

  const PREFIX = 'ukr_';
  const store = {
    get(key, fallback = null) {
      try {
        const value = localStorage.getItem(PREFIX + key);
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* хранилище недоступно */ }
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch { /* хранилище недоступно */ }
    },
  };

  const ERRORS = [
    [/invalid login credentials/i, 'Неверная почта или пароль'],
    [/already registered|already exists/i, 'Пользователь с такой почтой уже зарегистрирован'],
    [/password should be at least/i, 'Пароль слишком короткий — минимум 6 символов'],
    [/email not confirmed/i, 'Почта не подтверждена. Введите код из письма от «ВкусЗдоровья»'],
    [/token has expired|otp.*(expired|invalid)|invalid.*otp/i, 'Код неверный или устарел. Запросите новый'],
    [/only request this after|security purposes/i, 'Код уже отправлен. Повторно запросить можно через минуту'],
    [/signups not allowed for otp|user not found/i, 'Аккаунт с такой почтой не найден'],
    [/error sending|sending (confirmation|recovery|magic)/i, 'Не удалось отправить письмо. Проверьте адрес почты или попробуйте позже'],
    [/email address .* is invalid|email_address_invalid/i, 'Такой адрес почты не принимается — проверьте его'],
    [/unable to validate email|invalid email|invalid format/i, 'Некорректный адрес почты'],
    [/rate limit|too many/i, 'Слишком много попыток. Попробуйте через несколько минут'],
    [/failed to fetch|networkerror|load failed/i, 'Нет связи с сервером. Проверьте интернет'],
    [/row-level security|permission denied|нет доступа/i, 'Недостаточно прав для этого действия'],
    [/could not find the function|function .* does not exist/i, 'Админ-панель ещё не настроена: выполните supabase/schema-3-admin.sql'],
  ];

  function humanError(err) {
    const msg = (err && err.message) || String(err);
    const hit = ERRORS.find(([re]) => re.test(msg));
    return new Error(hit ? hit[1] : msg);
  }

  async function run(query) {
    const { data, error } = await query;
    if (error) throw humanError(error);
    return data;
  }

  /* «Запомнить меня»: если галочка снята, сессия живёт только до закрытия вкладки */
  function rememberSession(remember) {
    store.set('session_only', !remember);
    try { sessionStorage.setItem(PREFIX + 'tab', '1'); } catch { /* недоступно */ }
  }
  function sessionAllowed() {
    if (!store.get('session_only', false)) return true;
    try { return sessionStorage.getItem(PREFIX + 'tab') === '1'; } catch { return true; }
  }

  async function hash(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return 'x' + h;
  }

  /* полный адрес страницы сайта — для ссылок в письмах */
  const pageUrl = (page) => location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '') + page;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function validateCredentials({ email, password }) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('Некорректный адрес почты');
    if (!password || password.length < 6) throw new Error('Пароль слишком короткий — минимум 6 символов');
  }

  /* ===================== Supabase ===================== */

  const remote = {
    auth: {
      async signUp({ name, email, password }) {
        validateCredentials({ email, password });
        const data = await run(sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: pageUrl('login.html') } }));
        // Supabase не сообщает об уже занятой почте явно: у такого «нового» пользователя пустой список identities
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('Аккаунт с этой почтой уже зарегистрирован. Войдите или восстановите пароль');
        }
        if (data.session) rememberSession(true);
        return { needsConfirm: !data.session };
      },
      /* вход в два шага: пароль, затем код из письма */
      async signIn({ email, password }) {
        await run(sb.auth.signInWithPassword({ email, password }));
        await sb.auth.signOut({ scope: 'local' });
        await run(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
        return { needsCode: true };
      },
      async resendLoginCode(email) {
        await run(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
      },
      async verifyLoginCode(email, code, remember = true) {
        await run(sb.auth.verifyOtp({ email, token: code, type: 'email' }));
        rememberSession(remember);
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async getUser() {
        const { data } = await sb.auth.getSession();
        const session = data && data.session;
        if (!session) return null;
        if (!sessionAllowed()) {
          await sb.auth.signOut();
          return null;
        }
        const u = session.user;
        const profile = await run(sb.from('profiles').select('*').eq('id', u.id).maybeSingle());
        return {
          id: u.id,
          email: u.email,
          name: (profile && profile.name) || (u.user_metadata && u.user_metadata.name) || u.email,
          plan: (profile && profile.plan) || 'basic',
          role: (profile && profile.role) || 'user',
        };
      },
      async updatePlan(plan) {
        const user = await remote.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        await run(sb.from('profiles').update({ plan }).eq('id', user.id));
      },
      async resendConfirmation(email) {
        await run(sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: pageUrl('login.html') } }));
      },
      async verifySignupCode(email, code) {
        await run(sb.auth.verifyOtp({ email, token: code, type: 'signup' }));
        rememberSession(true);
      },
      async resetPassword(email) {
        await run(sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('login.html') }));
      },
      async updatePassword(password) {
        validateCredentials({ email: 'a@b.cd', password });
        await run(sb.auth.updateUser({ password }));
      },
      onPasswordRecovery(callback) {
        sb.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') callback();
        });
      },
    },

    rations: {
      async list() {
        return run(sb.from('rations').select('id, title, data, created_at').order('created_at', { ascending: false }));
      },
      async save({ title, data }) {
        return run(sb.from('rations').insert({ title, data }).select('id').single());
      },
      async remove(id) {
        await run(sb.from('rations').delete().eq('id', id));
      },
    },

    forum: {
      async list() {
        const rows = await run(
          sb.from('forum_posts')
            .select('id, title, body, topic, author_id, author_name, created_at, forum_replies(count)')
            .order('created_at', { ascending: false })
            .limit(200)
        );
        return rows.map((r) => ({ ...r, replies_count: (r.forum_replies && r.forum_replies[0] && r.forum_replies[0].count) || 0 }));
      },
      async create({ title, body, topic }) {
        return run(sb.from('forum_posts').insert({ title, body, topic }).select().single());
      },
      async remove(id) {
        await run(sb.from('forum_posts').delete().eq('id', id));
      },
      async replies(postId) {
        return run(sb.from('forum_replies').select('id, body, author_id, author_name, created_at').eq('post_id', postId).order('created_at'));
      },
      async reply(postId, body) {
        return run(sb.from('forum_replies').insert({ post_id: postId, body }).select().single());
      },
      async removeReply(id) {
        await run(sb.from('forum_replies').delete().eq('id', id));
      },
    },

    contact: {
      async send({ name, email, message }) {
        await run(sb.from('contact_messages').insert({ name, email, message }));
      },
    },
  };

  /* ===================== Демо-режим (localStorage) ===================== */

  function seedForum() {
    if (store.get('forum_posts')) return;
    const now = Date.now();
    store.set('forum_posts', [
      {
        id: 'seed1', topic: 'Рецепты', author_id: 'team', author_name: 'Команда «ВкусЗдоровья»',
        title: 'Делимся быстрыми полезными завтраками',
        body: 'Расскажите, что вы едите утром, если на готовку есть 10 минут. Начнём: овсянка на воде с ягодами и горстью орехов.',
        created_at: new Date(now - 86400000 * 2).toISOString(),
      },
      {
        id: 'seed2', topic: 'Вопросы', author_id: 'team', author_name: 'Команда «ВкусЗдоровья»',
        title: 'Как пользоваться конструктором рациона',
        body: 'Укажите норму калорий (её можно посчитать в калькуляторе), нажмите «Подобрать автоматически» и поправьте продукты под себя. Готовый рацион можно сохранить в аккаунте.',
        created_at: new Date(now - 86400000).toISOString(),
      },
    ]);
    store.set('forum_replies', []);
  }

  const local = {
    auth: {
      async signUp({ name, email, password }) {
        validateCredentials({ email, password });
        const users = store.get('users', {});
        const key = email.trim().toLowerCase();
        if (users[key]) throw new Error('Аккаунт с этой почтой уже зарегистрирован. Войдите или восстановите пароль');
        users[key] = { id: newId(), name: name.trim(), email: key, hash: await hash(password), plan: 'basic' };
        store.set('users', users);
        store.set('session', key);
        rememberSession(true);
        return { needsConfirm: false };
      },
      async signIn({ email, password, remember = true }) {
        const users = store.get('users', {});
        const key = (email || '').trim().toLowerCase();
        const user = users[key];
        if (!user || user.hash !== (await hash(password || ''))) throw new Error('Неверная почта или пароль');
        store.set('session', key);
        rememberSession(remember);
      },
      async signOut() {
        store.remove('session');
      },
      async getUser() {
        const key = store.get('session');
        if (!key || !sessionAllowed()) return null;
        const user = store.get('users', {})[key];
        return user ? { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role || 'user' } : null;
      },
      async updatePlan(plan) {
        const key = store.get('session');
        const users = store.get('users', {});
        if (!key || !users[key]) throw new Error('Сначала войдите в аккаунт');
        users[key].plan = plan;
        store.set('users', users);
      },
      async resetPassword() {
        throw new Error('В демо-режиме восстановление пароля недоступно — подключите базу данных');
      },
      async resendConfirmation() {},
      async verifySignupCode() {},
      async resendLoginCode() {},
      async verifyLoginCode() {},
      async updatePassword() {},
      onPasswordRecovery() {},
    },

    rations: {
      async list() {
        const user = await local.auth.getUser();
        if (!user) return [];
        return store.get('rations', []).filter((r) => r.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      async save({ title, data }) {
        const user = await local.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        const all = store.get('rations', []);
        const row = { id: newId(), user_id: user.id, title, data, created_at: new Date().toISOString() };
        all.push(row);
        store.set('rations', all);
        return { id: row.id };
      },
      async remove(id) {
        store.set('rations', store.get('rations', []).filter((r) => r.id !== id));
      },
    },

    forum: {
      async list() {
        seedForum();
        const replies = store.get('forum_replies', []);
        return store.get('forum_posts', [])
          .map((p) => ({ ...p, replies_count: replies.filter((r) => r.post_id === p.id).length }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      async create({ title, body, topic }) {
        const user = await local.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        const posts = store.get('forum_posts', []);
        const row = { id: newId(), title, body, topic, author_id: user.id, author_name: user.name, created_at: new Date().toISOString() };
        posts.push(row);
        store.set('forum_posts', posts);
        return row;
      },
      async remove(id) {
        store.set('forum_posts', store.get('forum_posts', []).filter((p) => p.id !== id));
        store.set('forum_replies', store.get('forum_replies', []).filter((r) => r.post_id !== id));
      },
      async replies(postId) {
        return store.get('forum_replies', []).filter((r) => r.post_id === postId);
      },
      async removeReply(id) {
        store.set('forum_replies', store.get('forum_replies', []).filter((r) => r.id !== id));
      },
      async reply(postId, body) {
        const user = await local.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        const all = store.get('forum_replies', []);
        const row = { id: newId(), post_id: postId, body, author_id: user.id, author_name: user.name, created_at: new Date().toISOString() };
        all.push(row);
        store.set('forum_replies', all);
        return row;
      },
    },

    contact: {
      async send(message) {
        const all = store.get('messages', []);
        all.push({ ...message, created_at: new Date().toISOString() });
        store.set('messages', all);
      },
    },
  };

  /* ===================== Личные данные: вес, расчёты, дневник ===================== */
  /*
   * Вошедший пользователь при подключённой базе хранит их в Supabase.
   * Гость (или демо-режим) — в localStorage, отдельно для каждого локального аккаунта.
   */

  const auth = useSupabase ? remote.auth : local.auth;

  async function remoteUserId() {
    if (!useSupabase) return null;
    const { data } = await sb.auth.getSession();
    return data && data.session && sessionAllowed() ? data.session.user.id : null;
  }

  async function localOwner() {
    const user = useSupabase ? null : await local.auth.getUser();
    return user ? user.id : 'guest';
  }

  function localTable(name) {
    return {
      async rows() {
        const owner = await localOwner();
        return store.get(name, []).filter((r) => r.owner === owner);
      },
      async insert(row) {
        const all = store.get(name, []);
        const full = { id: newId(), owner: await localOwner(), created_at: new Date().toISOString(), ...row };
        all.push(full);
        store.set(name, all);
        return full;
      },
      async remove(id) {
        store.set(name, store.get(name, []).filter((r) => r.id !== id));
      },
    };
  }

  const localWeights = localTable('weights');
  const localCalcs = localTable('calcs');
  const localDiary = localTable('diary');

  const weights = {
    async list() {
      if (await remoteUserId()) return run(sb.from('weight_log').select('id, date, weight').order('date'));
      return (await localWeights.rows()).sort((a, b) => a.date.localeCompare(b.date));
    },
    /* одна запись на день: повторное взвешивание в тот же день заменяет старое */
    async add({ date, weight }) {
      if (await remoteUserId()) {
        await run(sb.from('weight_log').upsert({ date, weight }, { onConflict: 'user_id,date' }));
        return;
      }
      const rows = await localWeights.rows();
      const same = rows.find((r) => r.date === date);
      if (same) await localWeights.remove(same.id);
      await localWeights.insert({ date, weight });
    },
    async remove(id) {
      if (await remoteUserId()) return run(sb.from('weight_log').delete().eq('id', id));
      return localWeights.remove(id);
    },
  };

  const calcs = {
    async list() {
      if (await remoteUserId()) {
        return run(sb.from('calculations').select('id, data, created_at').order('created_at', { ascending: false }).limit(50));
      }
      return (await localCalcs.rows()).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
    },
    async add(data) {
      if (await remoteUserId()) return run(sb.from('calculations').insert({ data }));
      const rows = await localCalcs.rows();
      if (rows.length >= 50) await localCalcs.remove(rows.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id);
      return localCalcs.insert({ data });
    },
    async remove(id) {
      if (await remoteUserId()) return run(sb.from('calculations').delete().eq('id', id));
      return localCalcs.remove(id);
    },
  };

  const DIARY_FIELDS = 'id, date, meal, name, grams, kcal, protein, fat, carbs';
  const diary = {
    /* записи за период [from; to], даты в формате ГГГГ-ММ-ДД */
    async list(from, to = from) {
      if (await remoteUserId()) {
        return run(sb.from('food_diary').select(DIARY_FIELDS).gte('date', from).lte('date', to).order('created_at'));
      }
      return (await localDiary.rows()).filter((r) => r.date >= from && r.date <= to);
    },
    async add(entries) {
      const list = Array.isArray(entries) ? entries : [entries];
      if (await remoteUserId()) return run(sb.from('food_diary').insert(list));
      for (const e of list) await localDiary.insert(e);
    },
    async remove(id) {
      if (await remoteUserId()) return run(sb.from('food_diary').delete().eq('id', id));
      return localDiary.remove(id);
    },
  };

  /* ===================== Администрирование ===================== */
  /* Права проверяет сама база (функции admin_* в schema-3-admin.sql), сайт только показывает данные */

  const remoteAdmin = {
    async claim(password) {
      return run(sb.rpc('admin_claim', { password }));
    },
    async stats() {
      return run(sb.rpc('admin_stats'));
    },
    async users() {
      return run(sb.rpc('admin_users'));
    },
    async setPlan(id, plan) {
      await run(sb.rpc('admin_set_plan', { target: id, new_plan: plan }));
    },
    async setRole(id, role) {
      await run(sb.rpc('admin_set_role', { target: id, new_role: role }));
    },
    async deleteUser(id) {
      await run(sb.rpc('admin_delete_user', { target: id }));
    },
    async messages() {
      return run(sb.from('contact_messages').select('*').order('created_at', { ascending: false }));
    },
    async deleteMessage(id) {
      await run(sb.from('contact_messages').delete().eq('id', id));
    },
  };

  /* в демо-режиме пароль админки — admin */
  const localAdmin = {
    async claim(password) {
      const key = store.get('session');
      const users = store.get('users', {});
      if (!key || !users[key]) throw new Error('Сначала войдите в аккаунт');
      if (password !== 'admin') return false;
      users[key].role = 'admin';
      store.set('users', users);
      return true;
    },
    async stats() {
      const users = Object.values(store.get('users', {}));
      return {
        users: users.length, confirmed: users.length, new_week: users.length,
        posts: store.get('forum_posts', []).length, replies: store.get('forum_replies', []).length,
        rations: store.get('rations', []).length, diary: store.get('diary', []).length,
        messages: store.get('messages', []).length,
      };
    },
    async users() {
      return Object.values(store.get('users', {})).map((u) => ({
        id: u.id, email: u.email, name: u.name, plan: u.plan, role: u.role || 'user',
        created_at: null, confirmed: true, last_sign_in_at: null,
      }));
    },
    async setPlan(id, plan) {
      const users = store.get('users', {});
      Object.values(users).forEach((u) => { if (u.id === id) u.plan = plan; });
      store.set('users', users);
    },
    async setRole(id, role) {
      const users = store.get('users', {});
      Object.values(users).forEach((u) => { if (u.id === id) u.role = role; });
      store.set('users', users);
    },
    async deleteUser(id) {
      const users = store.get('users', {});
      const me = store.get('session');
      Object.keys(users).forEach((k) => {
        if (users[k].id === id) {
          if (k === me) throw new Error('Нельзя удалить свой аккаунт из админки');
          delete users[k];
        }
      });
      store.set('users', users);
    },
    async messages() {
      return store.get('messages', []).map((m, i) => ({ id: String(i), ...m })).reverse();
    },
    async deleteMessage(id) {
      store.set('messages', store.get('messages', []).filter((_, i) => String(i) !== String(id)));
    },
  };

  window.DB = {
    mode: useSupabase ? 'supabase' : 'demo',
    store,
    ...(useSupabase ? remote : local),
    auth,
    weights,
    calcs,
    diary,
    admin: useSupabase ? remoteAdmin : localAdmin,
    async isCloud() { return Boolean(await remoteUserId()); },
  };
})();
