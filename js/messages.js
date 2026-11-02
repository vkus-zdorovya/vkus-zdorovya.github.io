/* Личные сообщения: список диалогов и переписка с участником */
(function () {
  const { esc, toast, avatarHtml, userReady } = window.UI;
  const $ = (id) => document.getElementById(id);
  const BAD_WORDS = 'Сообщение содержит недопустимые слова. Исправьте текст и попробуйте снова';

  let me = null;
  let peer = null; // { id, name, avatar_url }
  let conversations = [];
  let lastKey = '';

  const time = (iso) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  async function loadConversations() {
    try {
      conversations = await DB.dm.conversations();
    } catch (error) {
      $('dm-conversations').innerHTML = `<p class="form-error">${esc(/dm_conversations|schema cache|function/i.test(error.message)
        ? 'Личные сообщения ещё не подключены: выполните в Supabase файл schema-6-messages.sql'
        : error.message)}</p>`;
      return;
    }
    renderConversations();
    UI.refreshUnread && UI.refreshUnread();
  }

  function renderConversations() {
    const list = [...conversations];
    if (peer && !list.some((c) => c.peer_id === peer.id)) {
      list.unshift({ peer_id: peer.id, name: peer.name, avatar_url: peer.avatar_url, last_body: 'Новый диалог', unread: 0 });
    }
    $('dm-conversations').innerHTML = list.length ? list.map((c) => `
      <button type="button" class="dm-conv${peer && peer.id === c.peer_id ? ' active' : ''}" data-peer="${esc(c.peer_id)}">
        ${avatarHtml(c.name, c.avatar_url, 'avatar-md')}
        <span class="dm-conv-text">
          <span class="dm-conv-name">${esc(c.name)}</span>
          <span class="dm-conv-last">${c.last_from_me ? 'Вы: ' : ''}${esc(c.last_body || '')}</span>
        </span>
        ${c.unread ? `<span class="count-badge">${c.unread}</span>` : c.last_at ? `<span class="small muted">${esc(time(c.last_at))}</span>` : ''}
      </button>`).join('') : '<p class="muted small">Диалогов пока нет.</p>';
  }

  async function openPeer(id, push = true) {
    if (!id || id === me.id) return;
    const known = conversations.find((c) => c.peer_id === id);
    let info = known ? { id, name: known.name, avatar_url: known.avatar_url } : null;
    if (!info) {
      const profiles = await DB.publicProfiles([id]);
      if (!profiles[id]) {
        toast('Пользователь не найден', 'error');
        return;
      }
      info = profiles[id];
    }
    peer = info;
    lastKey = '';
    if (push) history.replaceState(null, '', `messages.html?to=${encodeURIComponent(id)}`);
    $('dm').classList.add('chat-open');
    $('dm-empty').classList.add('hidden');
    $('dm-chat-inner').classList.remove('hidden');
    const link = $('dm-peer');
    link.href = `profile.html?id=${encodeURIComponent(id)}`;
    link.innerHTML = `${avatarHtml(peer.name, peer.avatar_url, 'avatar-md')}<b>${esc(peer.name)}</b>`;
    $('dm-messages').innerHTML = '<p class="muted small center">Загрузка…</p>';
    renderConversations();
    await loadThread(true);
    $('dm-input').focus();
  }

  async function loadThread(scroll) {
    if (!peer) return;
    const current = peer.id;
    let rows;
    try {
      rows = await DB.dm.thread(current);
    } catch (error) {
      $('dm-messages').innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
      return;
    }
    if (!peer || peer.id !== current) return;
    const key = rows.map((r) => `${r.id}:${r.read_at ? 1 : 0}`).join(',');
    if (key === lastKey) return;
    lastKey = key;
    const box = $('dm-messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = rows.length ? rows.map((m) => `
      <div class="dm-msg${m.mine ? ' mine' : ''}" data-id="${esc(String(m.id))}">
        <div class="dm-bubble">${esc(m.body)}</div>
        <div class="dm-meta">${esc(time(m.created_at))}${m.mine ? (m.read_at ? ' · ✓✓ прочитано' : ' · ✓') : ''}
          ${m.mine ? '<button class="link-btn" type="button" data-del-dm>удалить</button>' : ''}</div>
      </div>`).join('') : '<p class="muted small center">Напишите первое сообщение 👋</p>';
    if (scroll || atBottom) box.scrollTop = box.scrollHeight;
    if (rows.some((m) => !m.mine && !m.read_at)) {
      await DB.dm.markRead(current).catch(() => {});
      loadConversations();
    }
  }

  $('dm-conversations').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-peer]');
    if (btn) openPeer(btn.dataset.peer);
  });

  $('dm-back').addEventListener('click', () => {
    $('dm').classList.remove('chat-open');
    peer = null;
    history.replaceState(null, '', 'messages.html');
    renderConversations();
  });

  $('dm-messages').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-dm]');
    if (!del || !confirm('Удалить сообщение у обоих собеседников?')) return;
    try {
      await DB.dm.remove(del.closest('.dm-msg').dataset.id);
      lastKey = '';
      loadThread();
      loadConversations();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

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

  $('dm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !peer) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      if (!(await DB.checkText(body))) throw new Error(BAD_WORDS);
      await DB.dm.send(peer.id, body);
      input.value = '';
      autosize();
      await loadThread(true);
      loadConversations();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  });

  userReady.then(async (user) => {
    me = user;
    if (!user) {
      $('dm-need-login').classList.remove('hidden');
      return;
    }
    $('dm').classList.remove('hidden');
    await loadConversations();
    const to = new URLSearchParams(location.search).get('to');
    if (to) openPeer(to, false);
    // новые сообщения подгружаются сами
    setInterval(() => {
      if (document.hidden) return;
      loadThread();
    }, 5000);
    setInterval(() => {
      if (!document.hidden) loadConversations();
    }, 20000);
  });
})();
