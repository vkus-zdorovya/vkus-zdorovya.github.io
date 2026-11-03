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
    [/could not find the function|function .* does not exist/i, 'Функция ещё не настроена в базе: выполните supabase/schema-3-admin.sql и schema-4-profile.sql'],
    [/duplicate key.*banned_words|banned_words_pkey/i, 'Такое слово уже есть в списке'],
    [/banned_words_word_check/i, 'Слово: только буквы и цифры, от 2 до 40 символов, можно со * на конце'],
    [/bucket not found/i, 'Хранилище аватарок не настроено: выполните supabase/schema-4-profile.sql'],
    [/payload too large|exceeded the maximum allowed size/i, 'Файл слишком большой — максимум 5 МБ'],
    [/mime type .* is not supported|invalid_mime_type/i, 'Этот формат не поддерживается. Нужен JPG, PNG, WebP или GIF'],
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

  /* ---------- демо-режим: запрещённые слова и мут (в базе это делают триггеры) ---------- */
  const localWords = () => store.get('banned_words', window.DEFAULT_BANNED_WORDS || []);
  function findBanned(text, words = localWords()) {
    const t = String(text || '').toLowerCase().replace(/ё/g, 'е');
    return words.find((w) => {
      const stem = w.endsWith('*') ? w.slice(0, -1) : w;
      const tail = w.endsWith('*') ? '' : '(?![а-яa-z0-9])';
      return new RegExp(`(^|[^а-яa-z0-9])${stem}${tail}`).test(t);
    }) || null;
  }
  function localGuard(user, text) {
    if (user.muted_until && new Date(user.muted_until) > new Date()) {
      throw new Error(`Вы не можете писать на форуме до ${new Date(user.muted_until).toLocaleString('ru-RU')}`);
    }
    if (findBanned(text)) throw new Error('Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова');
  }

  /* закреплённые комментарии — сверху, остальные по времени */
  const sortReplies = (rows) => [...rows].sort((a, b) =>
    (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || String(a.created_at).localeCompare(String(b.created_at)));

  /* публичная ссылка на файл аватарки в хранилище Supabase */
  function avatarUrl(path) {
    if (!path) return null;
    if (/^(data:|https?:)/.test(path)) return path;
    return sb ? sb.storage.from('avatars').getPublicUrl(path).data.publicUrl : null;
  }

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
          avatar_url: avatarUrl(profile && profile.avatar_url),
          avatar_pending: Boolean(profile && profile.avatar_pending),
          banner_url: avatarUrl(profile && profile.banner_url),
          banner_pending: Boolean(profile && profile.banner_pending),
          avatar_pending_url: avatarUrl(profile && profile.avatar_pending),
          banner_pending_url: avatarUrl(profile && profile.banner_pending),
          muted_until: (profile && profile.muted_until) || null,
          mute_reason: (profile && profile.mute_reason) || null,
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
      async list(authorId) {
        const query = (withPin) => {
          let q = sb.from('forum_posts')
            .select(`id, title, body, topic, author_id, author_name, created_at, ${withPin ? 'pinned, ' : ''}forum_replies(count)`);
          if (authorId) q = q.eq('author_id', authorId);
          if (withPin) q = q.order('pinned', { ascending: false });
          return q.order('created_at', { ascending: false }).limit(200);
        };
        let rows;
        try {
          rows = await run(query(true));
        } catch {
          rows = await run(query(false)); // schema-5 ещё не выполнен
        }
        return rows.map((r) => ({ ...r, replies_count: (r.forum_replies && r.forum_replies[0] && r.forum_replies[0].count) || 0 }));
      },
      async create({ title, body, topic }) {
        return run(sb.from('forum_posts').insert({ title, body, topic }).select().single());
      },
      async remove(id) {
        await run(sb.from('forum_posts').delete().eq('id', id));
      },
      async replies(postId) {
        const query = (withPin) => sb.from('forum_replies')
          .select(`id, body, author_id, author_name, created_at${withPin ? ', pinned' : ''}`).eq('post_id', postId).order('created_at');
        let rows;
        try {
          rows = await run(query(true));
        } catch {
          rows = await run(query(false)); // schema-6 ещё не выполнен
        }
        return sortReplies(rows);
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
        return user ? {
          id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role || 'user',
          avatar_url: user.avatar_url || null, avatar_pending: Boolean(user.avatar_pending),
          banner_url: user.banner_url || null, banner_pending: Boolean(user.banner_pending),
          avatar_pending_url: user.avatar_pending || null, banner_pending_url: user.banner_pending || null,
          muted_until: user.muted_until || null, mute_reason: user.mute_reason || null,
        } : null;
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
      async list(authorId) {
        seedForum();
        const replies = store.get('forum_replies', []);
        return store.get('forum_posts', [])
          .filter((p) => !authorId || p.author_id === authorId)
          .map((p) => ({ ...p, replies_count: replies.filter((r) => r.post_id === p.id).length }))
          .sort((a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || b.created_at.localeCompare(a.created_at));
      },
      async create({ title, body, topic }) {
        const user = await local.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        localGuard(user, title + ' ' + body);
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
        return sortReplies(store.get('forum_replies', []).filter((r) => r.post_id === postId));
      },
      async removeReply(id) {
        store.set('forum_replies', store.get('forum_replies', []).filter((r) => r.id !== id));
      },
      async reply(postId, body) {
        const user = await local.auth.getUser();
        if (!user) throw new Error('Сначала войдите в аккаунт');
        localGuard(user, body);
        const all = store.get('forum_replies', []);
        const row = { id: newId(), post_id: postId, body, author_id: user.id, author_name: user.name, created_at: new Date().toISOString() };
        all.push(row);
        store.set('forum_replies', all);
        return row;
      },
    },

    contact: {
      async send(message) {
        if (findBanned(message.name + ' ' + message.message)) throw new Error('Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова');
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
        avatars_pending: users.filter((u) => u.avatar_pending).length + users.filter((u) => u.banner_pending).length,
        muted: users.filter((u) => u.muted_until && new Date(u.muted_until) > new Date()).length,
      };
    },
    async users() {
      return Object.values(store.get('users', {})).map((u) => ({
        id: u.id, email: u.email, name: u.name, plan: u.plan, role: u.role || 'user',
        created_at: null, confirmed: true, last_sign_in_at: null,
        muted_until: u.muted_until || null, mute_reason: u.mute_reason || null,
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

  /* ===================== Профиль: ник и аватарка ===================== */

  const remoteProfile = {
    async updateName(name) {
      const { data } = await sb.auth.getSession();
      if (!data || !data.session) throw new Error('Сначала войдите в аккаунт');
      await run(sb.from('profiles').update({ name }).eq('id', data.session.user.id));
    },
    /* фото или баннер загружается в хранилище и ждёт одобрения администратора */
    async requestMedia(kind, blob) {
      const { data } = await sb.auth.getSession();
      if (!data || !data.session) throw new Error('Сначала войдите в аккаунт');
      const ext = { 'image/gif': 'gif', 'image/png': 'png', 'image/webp': 'webp' }[blob.type] || 'jpg';
      const path = `${data.session.user.id}/${kind}-${newId()}.${ext}`;
      await run(sb.storage.from('avatars').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
      return (await run(sb.rpc('request_media', { kind, path }))) || 'pending';
    },
    async removeMedia(kind) {
      await run(sb.rpc('remove_media', { kind }));
    },
  };

  const localProfile = {
    async updateName(name) {
      const key = store.get('session');
      const users = store.get('users', {});
      if (!key || !users[key]) throw new Error('Сначала войдите в аккаунт');
      if (findBanned(name)) throw new Error('Ник содержит недопустимые слова');
      users[key].name = name;
      store.set('users', users);
    },
    async requestMedia(kind, blob) {
      const key = store.get('session');
      const users = store.get('users', {});
      if (!key || !users[key]) throw new Error('Сначала войдите в аккаунт');
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      // администратору фото ставится сразу, остальным — после проверки
      const admin = users[key].role === 'admin';
      users[key][admin ? `${kind}_url` : `${kind}_pending`] = data;
      if (admin) users[key][`${kind}_pending`] = null;
      store.set('users', users);
      return admin ? 'approved' : 'pending';
    },
    async removeMedia(kind) {
      const key = store.get('session');
      const users = store.get('users', {});
      if (users[key]) {
        users[key][`${kind}_url`] = null;
        users[key][`${kind}_pending`] = null;
        store.set('users', users);
      }
    },
  };

  /* есть ли в тексте запрещённые слова (true — текст можно отправлять) */
  async function checkText(text) {
    if (!useSupabase) return !findBanned(text);
    try {
      return await run(sb.rpc('check_text', { txt: text }));
    } catch {
      return true; // функция ещё не создана — проверит сама база при отправке
    }
  }

  /* имена и одобренные аватарки авторов (для форума) */
  async function publicProfiles(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return {};
    let rows = [];
    if (useSupabase) {
      try {
        rows = await run(sb.rpc('public_profiles', { ids: unique }));
      } catch {
        rows = []; // функция ещё не создана — показываем без аватарок
      }
    } else {
      rows = Object.values(store.get('users', {})).filter((u) => unique.includes(u.id));
    }
    return Object.fromEntries(rows.map((r) => [r.id, {
      id: r.id, name: r.name, avatar_url: avatarUrl(r.avatar_url), banner_url: avatarUrl(r.banner_url), created_at: r.created_at || null,
    }]));
  }

  Object.assign(remoteAdmin, {
    async mediaRequests() {
      const rows = await run(sb.rpc('admin_media_requests'));
      return rows.map((r) => ({ ...r, pending_url: avatarUrl(r.pending), current_url: avatarUrl(r.current_path) }));
    },
    async reviewMedia(id, kind, approve) {
      const path = await run(sb.rpc('admin_review_media', { target: id, kind, approve }));
      // отклонённый файл удаляем из хранилища
      if (!approve && path) await sb.storage.from('avatars').remove([path]);
    },
    async pinPost(id, pin) {
      await run(sb.rpc('admin_pin_post', { post_id: id, pin }));
    },
    async mute(id, until, reason) {
      await run(sb.rpc('admin_mute', { target: id, until, reason }));
    },
    async words() {
      return (await run(sb.from('banned_words').select('word').order('word'))).map((r) => r.word);
    },
    async addWord(word) {
      await run(sb.from('banned_words').insert({ word }));
    },
    async removeWord(word) {
      await run(sb.from('banned_words').delete().eq('word', word));
    },
    async pinReply(id, pin) {
      await run(sb.rpc('admin_pin_reply', { reply_id: id, pin }));
    },
    async markAnswered(id, reply) {
      try {
        await run(sb.rpc('admin_mark_answered', { message_id: id, reply: reply || null }));
      } catch (error) {
        if (!/admin_mark_answered|function|schema cache/i.test(error.message)) throw error;
        // schema-6 ещё не выполнен — старый способ
        const rows = await run(sb.from('contact_messages').update({ answered_at: new Date().toISOString() }).eq('id', id).select('id'));
        if (!rows || !rows.length) throw new Error('Не удалось отметить: выполните в Supabase файл schema-6-messages.sql');
      }
    },
    /* отправка ответа с общей почты через функцию Supabase admin-reply */
    async sendReply(id, text) {
      const { data, error } = await sb.functions.invoke('admin-reply', { body: { message_id: id, text } });
      if (!error) return data;
      let message = error.message;
      let status = 0;
      if (error.context && typeof error.context.json === 'function') {
        status = error.context.status;
        try { message = (await error.context.json()).error || message; } catch { /* не JSON */ }
      }
      const err = new Error(message);
      err.noFunction = status === 404 || error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError';
      throw err;
    },
  });

  Object.assign(localAdmin, {
    async mediaRequests() {
      const list = [];
      Object.values(store.get('users', {})).forEach((u) => ['avatar', 'banner'].forEach((kind) => {
        if (u[`${kind}_pending`]) {
          list.push({ id: u.id, email: u.email, name: u.name, kind, pending_url: u[`${kind}_pending`], current_url: u[`${kind}_url`] || null });
        }
      }));
      return list;
    },
    async reviewMedia(id, kind, approve) {
      const users = store.get('users', {});
      Object.values(users).forEach((u) => {
        if (u.id !== id) return;
        if (approve) u[`${kind}_url`] = u[`${kind}_pending`];
        u[`${kind}_pending`] = null;
      });
      store.set('users', users);
    },
    async pinPost(id, pin) {
      store.set('forum_posts', store.get('forum_posts', []).map((p) => (p.id === id ? { ...p, pinned: pin } : p)));
    },
    async mute(id, until, reason) {
      const users = store.get('users', {});
      Object.values(users).forEach((u) => {
        if (u.id === id) { u.muted_until = until; u.mute_reason = until ? reason : null; }
      });
      store.set('users', users);
    },
    async words() {
      return [...localWords()].sort();
    },
    async addWord(word) {
      store.set('banned_words', [...new Set([...localWords(), word])]);
    },
    async removeWord(word) {
      store.set('banned_words', localWords().filter((w) => w !== word));
    },
    async pinReply(id, pin) {
      store.set('forum_replies', store.get('forum_replies', []).map((r) => (r.id === id ? { ...r, pinned: pin } : r)));
    },
    async markAnswered(id, reply) {
      const all = store.get('messages', []);
      if (all[Number(id)]) {
        all[Number(id)].answered_at = new Date().toISOString();
        if (reply) all[Number(id)].reply_text = reply;
      }
      store.set('messages', all);
    },
    async sendReply() {
      const err = new Error('В демо-режиме письма не отправляются');
      err.noFunction = true;
      throw err;
    },
  });

  /* ===================== Личные сообщения ===================== */

  const remoteDm = {
    async conversations() {
      const rows = await run(sb.rpc('dm_conversations'));
      return rows.map((r) => ({ ...r, avatar_url: avatarUrl(r.avatar_url) }));
    },
    async thread(peerId) {
      const { data } = await sb.auth.getSession();
      const me = data && data.session && data.session.user.id;
      if (!me) throw new Error('Сначала войдите в аккаунт');
      const rows = await run(sb.from('direct_messages').select('id, sender_id, recipient_id, body, created_at, read_at')
        .or(`and(sender_id.eq.${me},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${me})`)
        .order('created_at', { ascending: false }).limit(300));
      return rows.reverse().map((r) => ({ ...r, mine: r.sender_id === me }));
    },
    async send(peerId, body) {
      return run(sb.from('direct_messages').insert({ recipient_id: peerId, body }).select().single());
    },
    async remove(id) {
      await run(sb.from('direct_messages').delete().eq('id', id));
    },
    async markRead(peerId) {
      await run(sb.rpc('dm_mark_read', { peer: peerId }));
    },
    async unread() {
      try {
        return (await run(sb.rpc('dm_unread_count'))) || 0;
      } catch {
        return 0;
      }
    },
  };

  const localDm = {
    async me() {
      const user = await local.auth.getUser();
      if (!user) throw new Error('Сначала войдите в аккаунт');
      return user;
    },
    async conversations() {
      const me = await localDm.me();
      const users = Object.values(store.get('users', {}));
      const byPeer = {};
      store.get('dms', []).filter((m) => m.sender_id === me.id || m.recipient_id === me.id).forEach((m) => {
        const peer = m.sender_id === me.id ? m.recipient_id : m.sender_id;
        const c = byPeer[peer] || (byPeer[peer] = { peer_id: peer, unread: 0 });
        if (!c.last_at || m.created_at > c.last_at) Object.assign(c, { last_body: m.body, last_at: m.created_at, last_from_me: m.sender_id === me.id });
        if (m.recipient_id === me.id && !m.read_at) c.unread += 1;
      });
      return Object.values(byPeer).map((c) => {
        const u = users.find((x) => x.id === c.peer_id) || {};
        return { ...c, name: u.name || 'Пользователь', avatar_url: u.avatar_url || null };
      }).sort((a, b) => b.last_at.localeCompare(a.last_at));
    },
    async thread(peerId) {
      const me = await localDm.me();
      return store.get('dms', [])
        .filter((m) => (m.sender_id === me.id && m.recipient_id === peerId) || (m.sender_id === peerId && m.recipient_id === me.id))
        .map((m) => ({ ...m, mine: m.sender_id === me.id }));
    },
    async send(peerId, body) {
      const me = await localDm.me();
      if (peerId === me.id) throw new Error('Нельзя написать самому себе');
      localGuard(me, body);
      const all = store.get('dms', []);
      const row = { id: newId(), sender_id: me.id, recipient_id: peerId, body, created_at: new Date().toISOString(), read_at: null };
      all.push(row);
      store.set('dms', all);
      return row;
    },
    async remove(id) {
      store.set('dms', store.get('dms', []).filter((m) => m.id !== id));
    },
    async markRead(peerId) {
      const me = await localDm.me();
      store.set('dms', store.get('dms', []).map((m) => (m.sender_id === peerId && m.recipient_id === me.id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)));
    },
    async unread() {
      const user = await local.auth.getUser();
      if (!user) return 0;
      return store.get('dms', []).filter((m) => m.recipient_id === user.id && !m.read_at).length;
    },
  };


  /* ===================== База продуктов для сканера ===================== */

  const OFF_FIELDS = 'product_name,product_name_ru,brands,image_front_small_url,nutriments,nutriscore_grade,nova_group,additives_tags,ingredients_text_ru,ingredients_text,categories_tags,quantity';
  const offBase = () => (window.APP_CONFIG && APP_CONFIG.useProxy ? location.origin + '/off' : 'https://world.openfoodfacts.org');

  /* запасной путь: прямой запрос к Open Food Facts (без VPN на мобильном может не работать) */
  async function offLookup(code) {
    const res = await fetch(`${offBase()}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(res.statusText);
    const body = await res.json();
    return body.status === 1 && body.product ? body.product : null;
  }

  /* фото, которое приложил участник, лежит в нашем хранилище */
  function withImage(product) {
    if (product && product.image_path && !product.image_front_small_url) {
      return { ...product, image_front_small_url: avatarUrl(product.image_path) };
    }
    return product;
  }

  const remoteProducts = {
    async lookup(code) {
      // 1) через функцию Supabase: наша база + Open Food Facts со стороны сервера
      try {
        const { data, error } = await sb.functions.invoke('product', { body: { code } });
        if (!error && data && !data.error) return { product: withImage(data.product), source: data.source || null };
      } catch { /* функция не подключена — пробуем дальше */ }
      // 2) напрямую из нашей таблицы
      try {
        const row = await run(sb.from('products').select('data, source').eq('barcode', code).maybeSingle());
        if (row) return { product: withImage(row.data), source: row.source };
      } catch { /* таблицы ещё нет */ }
      // 3) напрямую из Open Food Facts
      return { product: await offLookup(code), source: 'off' };
    },
    async submit(fields, photos) {
      const { data } = await sb.auth.getSession();
      if (!data || !data.session) throw new Error('Сначала войдите в аккаунт');
      const upload = async (blob, kind) => {
        const path = `${data.session.user.id}/product-${fields.barcode}-${kind}-${newId()}.jpg`;
        await run(sb.storage.from('avatars').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
        return path;
      };
      const photoPath = await upload(photos.front, 'front');
      const labelPath = await upload(photos.label, 'label');
      await run(sb.from('product_requests').insert({ ...fields, photo_path: photoPath, photo_label_path: labelPath }));
    },
  };

  const localProducts = {
    async lookup(code) {
      const own = store.get('products', {})[code];
      if (own) return { product: own, source: 'user' };
      return { product: await offLookup(code), source: 'off' };
    },
    async submit(fields, photos) {
      const user = await local.auth.getUser();
      if (!user) throw new Error('Сначала войдите в аккаунт');
      localGuard(user, [fields.name, fields.brand, fields.ingredients].join(' '));
      const all = store.get('product_requests', []);
      if (all.some((r) => r.barcode === fields.barcode && r.user_id === user.id && r.status === 'pending')) {
        throw new Error('Вы уже отправили этот товар — он ждёт проверки');
      }
      const toUrl = (blob) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      all.push({ ...fields, id: newId(), user_id: user.id, author_name: user.name, author_email: user.email,
        photo_url: await toUrl(photos.front), photo_label_url: await toUrl(photos.label), status: 'pending', created_at: new Date().toISOString() });
      store.set('product_requests', all);
    },
  };

  /* карточка товара в формате Open Food Facts — как её показывает сканер */
  function productCard(r, image) {
    const nutriments = { 'energy-kcal_100g': r.kcal, proteins_100g: r.protein, fat_100g: r.fat, carbohydrates_100g: r.carbs };
    if (r.sugars != null) nutriments.sugars_100g = r.sugars;
    if (r.salt != null) nutriments.salt_100g = r.salt;
    return {
      product_name: r.name, brands: r.brand || undefined, quantity: r.quantity || undefined,
      ingredients_text_ru: r.ingredients || undefined, image_front_small_url: image || undefined,
      categories_tags: r.is_drink ? ['en:beverages'] : [], nutriments,
    };
  }

  Object.assign(remoteAdmin, {
    async productRequests() {
      const rows = await run(sb.rpc('admin_product_requests'));
      return rows.map((r) => ({ ...r, photo_url: avatarUrl(r.photo_path), photo_label_url: avatarUrl(r.photo_label_path) }));
    },
    async reviewProduct(id, approve) {
      await run(sb.rpc('admin_review_product', { request_id: id, approve }));
    },
  });

  Object.assign(localAdmin, {
    async productRequests() {
      const own = store.get('products', {});
      return store.get('product_requests', []).filter((r) => r.status === 'pending').map((r) => ({ ...r, existing: Boolean(own[r.barcode]) }));
    },
    async reviewProduct(id, approve) {
      const all = store.get('product_requests', []);
      const r = all.find((x) => x.id === id);
      if (!r) return;
      r.status = approve ? 'approved' : 'rejected';
      if (approve) {
        const own = store.get('products', {});
        own[r.barcode] = productCard(r, r.photo_url);
        store.set('products', own);
      }
      store.set('product_requests', all);
    },
  });

  /* поиск участников по нику (без почты) */
  async function searchUsers(q) {
    const term = String(q || '').trim();
    if (term.length < 2) return [];
    let rows;
    if (useSupabase) {
      rows = await run(sb.rpc('search_profiles', { q: term }));
    } else {
      const posts = store.get('forum_posts', []);
      rows = Object.values(store.get('users', {}))
        .filter((u) => (u.name || '').toLowerCase().includes(term.toLowerCase()))
        .slice(0, 20)
        .map((u) => ({ ...u, posts: posts.filter((p) => p.author_id === u.id).length }));
    }
    return rows.map((r) => ({ id: r.id, name: r.name, avatar_url: avatarUrl(r.avatar_url), created_at: r.created_at || null, posts: r.posts || 0 }));
  }

  window.DB = {
    mode: useSupabase ? 'supabase' : 'demo',
    store,
    ...(useSupabase ? remote : local),
    auth,
    weights,
    calcs,
    diary,
    admin: useSupabase ? remoteAdmin : localAdmin,
    profile: useSupabase ? remoteProfile : localProfile,
    dm: useSupabase ? remoteDm : localDm,
    products: useSupabase ? remoteProducts : localProducts,
    publicProfiles,
    searchUsers,
    checkText,
    async isCloud() { return Boolean(await remoteUserId()); },
  };
})();
