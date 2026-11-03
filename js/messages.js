/* Сообщения: личные чаты и беседы, фото, файлы и голосовые */
(function () {
  const { esc, toast, avatarHtml, userReady } = window.UI;
  const $ = (id) => document.getElementById(id);
  const BAD_WORDS = 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';
  const MAX_FILE = 20 * 1024 * 1024;
  const MAX_VOICE = 120; // секунд
  const MISSING = 'Беседы ещё не подключены: выполните в Supabase файл schema-9-chats.sql';

  let me = null;
  let chats = [];
  let current = null; // строка из списка чатов
  let members = [];
  let lastKey = '';
  const urls = {}; // путь файла → { url, at }
  let attachment = null; // { file, name, kind }

  /* ---------- оформление ---------- */

  const time = (iso) => {
    const d = new Date(iso);
    return new Date().toDateString() === d.toDateString()
      ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
  const secs = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'участник' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'участника' : 'участников');
  const missing = (error) => error.message === MISSING || /chat_list|schema cache/i.test(error.message);
  const same = (a, b) => String(a) === String(b);

  const preview = (c) => {
    const what = { image: '📷 Фото', voice: '🎤 Голосовое', file: '📎 Файл' }[c.last_kind];
    const text = what ? (c.last_body ? `${what}: ${c.last_body}` : what) : (c.last_body || '');
    if (c.last_kind === 'system') return text;
    const who = c.last_from_me ? 'Вы: ' : c.is_group && c.last_sender ? `${c.last_sender}: ` : '';
    return who + text;
  };
  const chatAvatar = (c, cls) => (c.is_group
    ? `<span class="avatar ${cls} avatar-group" aria-hidden="true">👥</span>`
    : avatarHtml(c.title, c.peer_avatar, cls));

  /* ---------- список чатов ---------- */

  async function loadChats() {
    try {
      chats = await DB.chat.list();
    } catch (error) {
      $('dm-conversations').innerHTML = `<p class="form-error small">${esc(missing(error) ? MISSING : error.message)}</p>`;
      return;
    }
    renderChats();
    if (current) {
      const fresh = chats.find((c) => same(c.id, current.id));
      if (fresh) { current = fresh; renderHead(); }
    }
    if (UI.refreshUnread) UI.refreshUnread();
  }

  function renderChats() {
    $('dm-conversations').innerHTML = chats.length ? chats.map((c) => `
      <button type="button" class="dm-conv${current && same(current.id, c.id) ? ' active' : ''}" data-chat="${esc(String(c.id))}">
        ${chatAvatar(c, 'avatar-md')}
        <span class="dm-conv-text">
          <span class="dm-conv-name">${esc(c.title || 'Беседа')}${c.is_group ? ` <span class="small muted">· ${c.members}</span>` : ''}</span>
          <span class="dm-conv-last">${esc(preview(c))}</span>
        </span>
        ${c.unread ? `<span class="count-badge">${c.unread}</span>` : c.last_at ? `<span class="small muted">${esc(time(c.last_at))}</span>` : ''}
      </button>`).join('') : '<p class="muted small">Диалогов пока нет. Найдите человека через поиск или создайте беседу.</p>';
  }

  /* ---------- открытый чат ---------- */

  function renderHead() {
    const link = $('dm-peer');
    if (current.is_group) {
      link.removeAttribute('href');
      link.setAttribute('role', 'button');
      link.setAttribute('tabindex', '0');
      link.innerHTML = `${chatAvatar(current, 'avatar-md')}<span class="dm-peer-text"><b>${esc(current.title)}</b><span class="small muted">${current.members} ${plural(current.members)}</span></span>`;
    } else {
      link.href = `profile.html?id=${encodeURIComponent(current.peer_id)}`;
      link.removeAttribute('role');
      link.removeAttribute('tabindex');
      link.innerHTML = `${chatAvatar(current, 'avatar-md')}<span class="dm-peer-text"><b>${esc(current.title)}</b></span>`;
    }
    $('dm-info-btn').classList.toggle('hidden', !current.is_group);
  }

  async function openChat(id, push = true) {
    let c = chats.find((x) => same(x.id, id));
    if (!c) {
      await loadChats();
      c = chats.find((x) => same(x.id, id));
      if (!c) { toast('Беседа не найдена', 'error'); return; }
    }
    current = c;
    members = [];
    lastKey = '';
    clearAttachment();
    if (push) history.replaceState(null, '', `messages.html?c=${encodeURIComponent(c.id)}`);
    $('dm').classList.add('chat-open');
    $('dm-empty').classList.add('hidden');
    $('dm-chat-inner').classList.remove('hidden');
    $('dm-info').classList.add('hidden');
    renderHead();
    renderChats();
    $('dm-messages').innerHTML = '<p class="muted small center">Загрузка…</p>';
    await loadMembers();
    await loadThread(true);
    if (matchMedia('(min-width: 761px)').matches) $('dm-input').focus();
  }

  async function loadMembers() {
    if (!current) return;
    try { members = await DB.chat.members(current.id); } catch { members = []; }
    if (current.is_group) renderInfo();
  }

  async function signedUrls(rows) {
    const need = rows.filter((m) => m.file_path && !m.file_url && (!urls[m.file_path] || Date.now() - urls[m.file_path].at > 50 * 60 * 1000))
      .map((m) => m.file_path);
    if (!need.length) return;
    try {
      const got = await DB.chat.fileUrls([...new Set(need)]);
      Object.entries(got).forEach(([path, url]) => { urls[path] = { url, at: Date.now() }; });
    } catch { /* ссылки подгрузятся при следующем обновлении */ }
  }
  const fileUrl = (m) => m.file_url || (urls[m.file_path] && urls[m.file_path].url) || '';

  function renderMessage(m, prev) {
    if (m.kind === 'system') return `<div class="dm-system">${esc(m.body)}</div>`;
    const mine = m.sender_id === me.id;
    const who = members.find((x) => x.user_id === m.sender_id);
    const name = who ? who.name : 'Бывший участник';
    const showName = current.is_group && !mine && (!prev || prev.sender_id !== m.sender_id || prev.kind === 'system');
    const url = fileUrl(m);
    let media = '';
    if (m.kind === 'image') {
      media = url
        ? `<button type="button" class="dm-img" data-view="${esc(url)}" aria-label="Открыть фото"><img src="${esc(url)}" alt="${esc(m.file_name || 'Фото')}" loading="lazy"></button>`
        : '<div class="dm-img dm-img-wait" aria-hidden="true">📷</div>';
    } else if (m.kind === 'voice') {
      media = `<div class="dm-voice"><span aria-hidden="true">🎤</span>${url ? `<audio controls preload="metadata" src="${esc(url)}"></audio>` : '<span class="small">загрузка…</span>'}
        ${m.duration ? `<span class="small">${secs(m.duration)}</span>` : ''}</div>`;
    } else if (m.kind === 'file') {
      media = `<a class="dm-file"${url ? ` href="${esc(url)}" download="${esc(m.file_name || 'файл')}" target="_blank" rel="noopener"` : ''}>
        <span class="dm-file-icon" aria-hidden="true">📎</span>
        <span class="dm-file-text"><b>${esc(m.file_name || 'Файл')}</b><span class="small">${m.file_size ? size(m.file_size) : ''}${url ? ' · скачать' : ''}</span></span></a>`;
    }
    let read = '';
    if (mine && !current.is_group) {
      const peer = members.find((x) => x.user_id !== me.id);
      read = peer && peer.last_read_at >= m.created_at ? ' · ✓✓' : ' · ✓';
    }
    return `
      <div class="dm-msg${mine ? ' mine' : ''}" data-id="${esc(String(m.id))}">
        ${current.is_group && !mine ? `<span class="dm-msg-avatar">${showName ? avatarHtml(name, who && who.avatar_url, 'avatar-sm') : ''}</span>` : ''}
        <div class="dm-msg-col">
          ${showName ? `<div class="dm-name">${esc(name)}</div>` : ''}
          <div class="dm-bubble${media && !m.body ? ' only-media' : ''}">${media}${m.body ? `<div class="dm-text">${esc(m.body)}</div>` : ''}</div>
          <div class="dm-meta">${esc(time(m.created_at))}${read}${mine ? ' <button class="link-btn" type="button" data-del-msg>удалить</button>' : ''}</div>
        </div>
      </div>`;
  }

  async function loadThread(scroll) {
    if (!current) return;
    const id = current.id;
    let rows;
    try {
      rows = await DB.chat.messages(id);
    } catch (error) {
      $('dm-messages').innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
      return;
    }
    if (!current || !same(current.id, id)) return;
    await signedUrls(rows);
    const peer = members.find((x) => x.user_id !== me.id);
    const key = rows.map((r) => `${r.id}:${fileUrl(r) ? 1 : 0}`).join(',') + `|${peer ? peer.last_read_at : ''}|${members.length}`;
    if (key === lastKey) return;
    lastKey = key;
    const box = $('dm-messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = rows.length ? rows.map((m, i) => renderMessage(m, rows[i - 1])).join('')
      : '<p class="muted small center">Напишите первое сообщение 👋</p>';
    if (scroll || atBottom) {
      box.scrollTop = box.scrollHeight;
      // фото догружаются позже — докручиваем вниз, когда они появятся
      box.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true }));
    }
    const row = chats.find((c) => same(c.id, id));
    if (row && row.unread) {
      await DB.chat.markRead(id).catch(() => {});
      loadChats();
    }
  }

  /* ---------- участники беседы ---------- */

  function renderInfo() {
    const mine = members.find((x) => x.user_id === me.id);
    const owner = mine && mine.role === 'owner';
    if (document.activeElement !== $('dm-rename-input')) $('dm-rename-input').value = current.title || '';
    $('dm-members-count').textContent = `(${members.length})`;
    $('dm-members').innerHTML = members.map((u) => `
      <div class="dm-member">
        <a class="post-author" href="profile.html?id=${encodeURIComponent(u.user_id)}">${avatarHtml(u.name, u.avatar_url, 'avatar-sm')}${esc(u.name)}</a>
        ${u.role === 'owner' ? '<span class="tag">создатель</span>' : ''}
        ${u.user_id === me.id ? '<span class="small muted">это вы</span>' : ''}
        ${owner && u.user_id !== me.id ? `<button class="link-btn danger" type="button" data-kick="${esc(u.user_id)}">исключить</button>` : ''}
      </div>`).join('');
  }

  const toggleInfo = () => $('dm-info').classList.toggle('hidden');
  $('dm-info-btn').addEventListener('click', toggleInfo);
  $('dm-peer').addEventListener('click', (e) => {
    if (current && current.is_group) { e.preventDefault(); toggleInfo(); }
  });
  $('dm-peer').addEventListener('keydown', (e) => {
    if (current && current.is_group && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleInfo(); }
  });

  $('dm-members').addEventListener('click', async (e) => {
    const kick = e.target.closest('[data-kick]');
    if (!kick) return;
    const u = members.find((x) => x.user_id === kick.dataset.kick);
    if (!confirm(`Исключить ${u ? u.name : 'участника'} из беседы?`)) return;
    try {
      await DB.chat.removeMember(current.id, kick.dataset.kick);
      await refreshOpen();
    } catch (error) { toast(error.message, 'error'); }
  });

  $('dm-rename').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('dm-rename-input').value.trim();
    if (!title || title === current.title) return;
    if (!(await DB.checkText(title))) { toast('Название содержит недопустимые слова', 'error'); return; }
    try {
      await DB.chat.rename(current.id, title);
      $('dm-rename-input').blur();
      toast('Беседа переименована');
      await refreshOpen();
    } catch (error) { toast(error.message, 'error'); }
  });

  $('dm-leave').addEventListener('click', async () => {
    if (!confirm('Выйти из беседы? Вернуть вас сможет только другой участник.')) return;
    try {
      await DB.chat.leave(current.id);
      closeChat();
      loadChats();
    } catch (error) { toast(error.message, 'error'); }
  });

  async function refreshOpen() {
    lastKey = '';
    await loadChats();
    await loadMembers();
    await loadThread(true);
  }

  function closeChat() {
    current = null;
    $('dm').classList.remove('chat-open');
    $('dm-chat-inner').classList.add('hidden');
    $('dm-empty').classList.remove('hidden');
    history.replaceState(null, '', 'messages.html');
    renderChats();
  }

  /* ---------- выбор людей: новая беседа и добавление участников ---------- */

  function picker(box, exclude) {
    const chosen = new Map();
    box.classList.add('picker');
    box.innerHTML = `<div class="picker-chips"></div>
      <input class="input" type="search" autocomplete="off" maxlength="40" placeholder="🔍 Найти по нику" aria-label="Найти участника по нику">
      <div class="user-search-results"></div>`;
    const field = box.querySelector('input');
    const out = box.querySelector('.user-search-results');
    const chips = box.querySelector('.picker-chips');
    let timer = null;
    let seq = 0;
    const renderChips = () => {
      chips.innerHTML = [...chosen.values()].map((u) => `<span class="chip">${esc(u.name)} <button class="link-btn" type="button" data-unpick="${esc(u.id)}" aria-label="Убрать ${esc(u.name)}">✕</button></span>`).join('');
      box.dispatchEvent(new Event('picked'));
    };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    field.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = field.value.trim();
        const n = ++seq;
        if (q.length < 2) { out.innerHTML = q ? '<p class="small muted">Введите хотя бы 2 буквы</p>' : ''; return; }
        let list = [];
        try { list = await DB.searchUsers(q); } catch (error) { out.innerHTML = `<p class="small form-error">${esc(error.message)}</p>`; return; }
        if (n !== seq) return;
        const skip = exclude();
        list = list.filter((u) => u.id !== me.id && !skip.includes(u.id));
        out.innerHTML = list.length ? list.map((u) => `
          <button type="button" class="user-result" data-pick="${esc(u.id)}" data-name="${esc(u.name)}">
            ${avatarHtml(u.name, u.avatar_url, 'avatar-md')}
            <span class="user-result-text"><b>${esc(u.name)}</b></span>
            <span class="user-result-go" aria-hidden="true">${chosen.has(u.id) ? '✓' : '＋'}</span>
          </button>`).join('') : '<p class="small muted">Никого не нашли</p>';
      }, 300);
    });
    box.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      const unpick = e.target.closest('[data-unpick]');
      if (pick) {
        if (chosen.has(pick.dataset.pick)) chosen.delete(pick.dataset.pick);
        else chosen.set(pick.dataset.pick, { id: pick.dataset.pick, name: pick.dataset.name });
        pick.querySelector('.user-result-go').textContent = chosen.has(pick.dataset.pick) ? '✓' : '＋';
        renderChips();
      }
      if (unpick) {
        chosen.delete(unpick.dataset.unpick);
        const row = out.querySelector(`[data-pick="${CSS.escape(unpick.dataset.unpick)}"] .user-result-go`);
        if (row) row.textContent = '＋';
        renderChips();
      }
    });
    return {
      ids: () => [...chosen.keys()],
      reset: () => { chosen.clear(); field.value = ''; out.innerHTML = ''; renderChips(); },
    };
  }

  const groupPicker = picker($('gm-picker'), () => []);
  const addPicker = picker($('dm-add-picker'), () => members.map((m) => m.user_id));
  $('dm-add-picker').addEventListener('picked', () => $('dm-add-btn').classList.toggle('hidden', !addPicker.ids().length));
  $('dm-add-btn').addEventListener('click', async () => {
    try {
      await DB.chat.addMembers(current.id, addPicker.ids());
      addPicker.reset();
      toast('Участники добавлены');
      await refreshOpen();
    } catch (error) { toast(error.message, 'error'); }
  });

  /* ---------- новая беседа ---------- */

  const modal = $('group-modal');
  $('new-group').addEventListener('click', () => {
    groupPicker.reset();
    $('gm-name').value = '';
    modal.querySelector('.form-error').textContent = '';
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
    $('gm-name').focus();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) modal.close();
  });
  $('group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = modal.querySelector('.form-error');
    const title = $('gm-name').value.trim();
    if (!title) { err.textContent = 'Придумайте название беседы'; return; }
    if (!groupPicker.ids().length) { err.textContent = 'Добавьте хотя бы одного участника — найдите его по нику'; return; }
    if (!(await DB.checkText(title))) { err.textContent = 'Название содержит недопустимые слова'; return; }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const id = await DB.chat.createGroup(title, groupPicker.ids());
      modal.close();
      await loadChats();
      openChat(id);
    } catch (error) {
      err.textContent = missing(error) ? MISSING : error.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- вложения ---------- */

  /* фото больше 1600 px уменьшаем — так они быстрее грузятся и меньше занимают места */
  function shrink(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        if (k === 1 && file.size < 1.5 * 1024 * 1024) { URL.revokeObjectURL(img.src); resolve(file); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  function clearAttachment() {
    attachment = null;
    $('dm-attach').classList.add('hidden');
    $('dm-attach').innerHTML = '';
  }

  $('dm-file').addEventListener('change', async () => {
    const file = $('dm-file').files[0];
    $('dm-file').value = '';
    if (!file) return;
    if (file.size > MAX_FILE) { toast('Файл слишком большой — максимум 20 МБ', 'error'); return; }
    const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    const blob = isImage && file.type !== 'image/gif' ? await shrink(file) : file;
    const name = isImage && blob !== file ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name;
    attachment = { file: blob, name, kind: isImage ? 'image' : 'file' };
    const box = $('dm-attach');
    box.innerHTML = `${isImage ? `<img src="${URL.createObjectURL(blob)}" alt="">` : '<span class="dm-file-icon" aria-hidden="true">📎</span>'}
      <span class="dm-file-text"><b>${esc(name)}</b><span class="small muted">${size(blob.size)} · можно добавить подпись</span></span>
      <button class="icon-btn" type="button" id="dm-attach-x" aria-label="Убрать вложение">✕</button>`;
    box.classList.remove('hidden');
    $('dm-attach-x').addEventListener('click', clearAttachment);
    $('dm-input').focus();
  });

  /* ---------- отправка ---------- */

  const input = $('dm-input');
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('dm-form').requestSubmit();
    }
  });

  async function send(msg) {
    try {
      if (msg.body && !(await DB.checkText(msg.body))) throw new Error(BAD_WORDS);
      await DB.chat.send(current.id, msg);
      lastKey = '';
      await loadThread(true);
      loadChats();
      return true;
    } catch (error) {
      toast(/row-level security|row level/i.test(error.message) ? 'Вы больше не участник этой беседы'
        : /mime|not supported|invalid.*type/i.test(error.message) ? 'Такой тип файла отправить нельзя' : error.message, 'error');
      return false;
    }
  }

  $('dm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    const body = input.value.trim();
    if (!body && !attachment) return;
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = attachment ? { kind: attachment.kind, file: attachment.file, name: attachment.name, body } : { kind: 'text', body };
    btn.disabled = true;
    if (attachment) btn.textContent = '⏳';
    const ok = await send(msg);
    btn.disabled = false;
    btn.textContent = '➤';
    if (ok) {
      input.value = '';
      autosize();
      clearAttachment();
    }
    input.focus();
  });

  /* ---------- голосовые ---------- */

  let recorder = null;
  let recChunks = [];
  let recStart = 0;
  let recTimer = null;
  let recCancel = false;

  const voiceType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';

  $('dm-mic').addEventListener('click', async () => {
    if (!current) return;
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Этот браузер не умеет записывать звук. Обновите Chrome или Safari', 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast(err && err.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера для этого сайта' : 'Микрофон не найден', 'error');
      return;
    }
    const type = voiceType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recChunks = [];
    recCancel = false;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      $('dm-recording').classList.add('hidden');
      $('dm-form').classList.remove('hidden');
      const duration = (Date.now() - recStart) / 1000;
      if (recCancel || duration < 0.7 || !recChunks.length) return;
      const mime = (recorder.mimeType || type || 'audio/webm').split(';')[0];
      const blob = new Blob(recChunks, { type: mime });
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      await send({ kind: 'voice', file: blob, name: `голосовое.${ext}`, duration: Math.round(duration) });
    };
    recorder.start();
    recStart = Date.now();
    $('dm-form').classList.add('hidden');
    $('dm-recording').classList.remove('hidden');
    $('dm-rec-time').textContent = '0:00';
    recTimer = setInterval(() => {
      const s = (Date.now() - recStart) / 1000;
      $('dm-rec-time').textContent = secs(s);
      if (s >= MAX_VOICE && recorder.state === 'recording') recorder.stop();
    }, 250);
  });
  $('dm-rec-send').addEventListener('click', () => { if (recorder && recorder.state === 'recording') recorder.stop(); });
  $('dm-rec-cancel').addEventListener('click', () => {
    recCancel = true;
    if (recorder && recorder.state === 'recording') recorder.stop();
  });

  /* ---------- удаление сообщений и просмотр фото ---------- */

  $('dm-messages').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      const box = $('img-viewer');
      box.querySelector('img').src = view.dataset.view;
      box.classList.remove('hidden');
      return;
    }
    const del = e.target.closest('[data-del-msg]');
    if (!del || !confirm('Удалить сообщение у всех участников?')) return;
    try {
      await DB.chat.remove(del.closest('.dm-msg').dataset.id);
      lastKey = '';
      loadThread();
      loadChats();
    } catch (error) { toast(error.message, 'error'); }
  });
  $('img-viewer').addEventListener('click', () => $('img-viewer').classList.add('hidden'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('img-viewer').classList.add('hidden'); });

  $('dm-conversations').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chat]');
    if (btn) openChat(btn.dataset.chat);
  });
  $('dm-back').addEventListener('click', closeChat);

  /* ---------- старт ---------- */

  userReady.then(async (user) => {
    me = user;
    if (!user) {
      $('dm-need-login').classList.remove('hidden');
      return;
    }
    $('dm').classList.remove('hidden');
    await loadChats();
    const params = new URLSearchParams(location.search);
    const to = params.get('to');
    const c = params.get('c');
    if (to && to !== me.id) {
      try {
        const id = await DB.chat.openDirect(to);
        await loadChats();
        openChat(id);
      } catch (error) { toast(missing(error) ? MISSING : error.message, 'error'); }
    } else if (c) {
      openChat(c, false);
    }
    // новые сообщения подгружаются сами
    setInterval(() => {
      if (document.hidden || !current) return;
      loadMembers().then(() => loadThread());
    }, 5000);
    setInterval(() => { if (!document.hidden) loadChats(); }, 15000);
  });
})();
