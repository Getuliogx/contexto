// ==UserScript==
// @name         Contexto Chat Render - Fila Corrigida
// @namespace    contexto-chat-render
// @version      1.5.0
// @description  Recebe nick/palavra/cor do Render e injeta no Contexto. Usa WebSocket + polling fallback.
// @match        https://contexto.me/*
// @match        https://www.contexto.me/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // TROQUE PELO SEU LINK DO RENDER, SEM BARRA NO FINAL
  const RENDER_URL = 'COLE_AQUI_O_LINK_DO_RENDER';

  const POLL_MS = 1200;
  const SEND_DELAY_MS = 900;
  const MAX_QUEUE = 30;
  const DEBUG = true;

  let lastId = localStorage.getItem('contextoChatLastId_v15') || '';
  let queue = [];
  let sending = false;
  let ws = null;
  let wsConnected = false;
  let receivedCount = 0;
  let sentCount = 0;
  const pendingByWord = new Map();

  function baseUrl() { return String(RENDER_URL || '').replace(/\/$/, ''); }
  function log(...args) { if (DEBUG) console.log('[Contexto Chat]', ...args); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function panel(text) {
    let el = document.getElementById('ctx-chat-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ctx-chat-panel';
      el.style.cssText = `
        position: fixed; right: 12px; bottom: 12px; z-index: 999999;
        background: rgba(0,0,0,.78); color: #fff; padding: 8px 10px;
        border-radius: 6px; font: 12px Arial, sans-serif; max-width: 360px;
        line-height: 1.35; pointer-events: none;
      `;
      document.body.appendChild(el);
    }
    el.innerHTML = text;
  }

  function updatePanel(extra='') {
    const renderOk = baseUrl() && !baseUrl().includes('COLE_AQUI');
    panel(
      `<b>Contexto Chat</b><br>` +
      `Render: ${renderOk ? 'configurado' : 'faltando link'}<br>` +
      `Conexão: ${wsConnected ? 'WebSocket OK' : 'polling'}<br>` +
      `Recebidas: ${receivedCount} | Enviadas: ${sentCount} | Fila: ${queue.length}` +
      (extra ? `<br>${extra}` : '')
    );
  }

  function httpGet(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 10000,
          onload: r => {
            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
          },
          onerror: reject,
          ontimeout: reject
        });
      } else {
        fetch(url, { cache: 'no-store' }).then(r => r.json()).then(resolve).catch(reject);
      }
    });
  }

  function normalizeWord(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function enqueue(item, origin) {
    if (!item || item.type && item.type !== 'guess') return;
    if (!item.id || !item.word) return;
    if (item.id === lastId) return;
    if (queue.some(x => x.id === item.id)) return;

    lastId = item.id;
    localStorage.setItem('contextoChatLastId_v15', lastId);
    queue.push(item);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    receivedCount++;
    log('recebido via', origin, item);
    updatePanel(`Última: <b>${escapeHtml(item.word)}</b> — ${escapeHtml(item.nick || '')}`);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function startWebSocket() {
    if (!baseUrl() || baseUrl().includes('COLE_AQUI')) {
      updatePanel('Erro: coloque o link do Render no script.');
      return;
    }
    try {
      const wsUrl = baseUrl().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { wsConnected = true; updatePanel(); log('websocket conectado'); };
      ws.onclose = () => { wsConnected = false; updatePanel('WebSocket caiu, usando polling.'); setTimeout(startWebSocket, 3000); };
      ws.onerror = () => { wsConnected = false; updatePanel('WebSocket erro, usando polling.'); };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'hello') {
            // Não joga fila antiga quando abre a aba. Só marca a última como vista.
            const recent = Array.isArray(data.recent) ? data.recent : [];
            if (!lastId && recent.length) {
              lastId = recent[recent.length - 1].id;
              localStorage.setItem('contextoChatLastId_v15', lastId);
            }
            return;
          }
          enqueue(data, 'websocket');
        } catch (e) { log('ws json erro', e); }
      };
    } catch (e) {
      log('ws falhou', e);
      updatePanel('WebSocket falhou, usando polling.');
    }
  }

  async function poll() {
    if (!baseUrl() || baseUrl().includes('COLE_AQUI')) return;
    try {
      const data = await httpGet(`${baseUrl()}/api/queue?after=${encodeURIComponent(lastId || '')}&t=${Date.now()}`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (!lastId && data.latestId) {
        lastId = data.latestId;
        localStorage.setItem('contextoChatLastId_v15', lastId);
      }
      for (const item of items) enqueue(item, 'polling');
    } catch (e) {
      log('poll falhou', e && e.message ? e.message : e);
      updatePanel('Polling falhou. Veja se o Render está online e se /api/queue existe.');
    }
  }

  function getInput() {
    const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 100 && r.height > 20 && st.display !== 'none' && st.visibility !== 'hidden' && !el.disabled && !el.readOnly;
    });
    return inputs.find(el => /text|search|^$/.test(el.type || '')) || inputs[0] || null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInputEvents(el, value) {
    el.focus();
    setNativeValue(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward', data: null }));
    setNativeValue(el, value);
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function fireEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function fireSafeSubmit(el) {
    const form = el.closest('form');
    if (!form) return false;
    let ev;
    try { ev = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: null }); }
    catch (_) { ev = new Event('submit', { bubbles: true, cancelable: true }); }
    form.dispatchEvent(ev);
    ev.preventDefault();
    return true;
  }

  async function sendToContexto(item) {
    const word = String(item.word || '').trim();
    if (!word) return false;
    const input = getInput();
    if (!input) { updatePanel('Não achei o campo do Contexto.'); return false; }

    fireInputEvents(input, word);
    await sleep(120);
    fireEnter(input);
    await sleep(220);
    fireSafeSubmit(input);
    await sleep(220);
    fireEnter(input);

    pendingByWord.set(normalizeWord(word), {
      nick: item.nick || 'chat',
      color: item.color || '#ffffff',
      word,
      time: Date.now()
    });
    sentCount++;
    updatePanel(`Enviado: <b>${escapeHtml(word)}</b> — ${escapeHtml(item.nick || '')}`);
    return true;
  }

  async function processQueue() {
    if (sending || !queue.length) return;
    sending = true;
    try {
      const item = queue.shift();
      await sendToContexto(item);
      await sleep(SEND_DELAY_MS);
      injectNicks();
    } catch (e) { console.error('[Contexto Chat] erro', e); }
    finally { sending = false; updatePanel(); }
  }

  function findRows() {
    return Array.from(document.querySelectorAll('div, li, tr, p')).filter(el => {
      const txt = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return txt && txt.length < 220 && /\d/.test(txt) && r.width > 120 && r.height >= 20;
    });
  }

  function injectNicks() {
    const rows = findRows();
    const now = Date.now();
    for (const [norm, info] of pendingByWord) {
      if (now - info.time > 10 * 60 * 1000) { pendingByWord.delete(norm); continue; }
      const row = rows.find(el => normalizeWord(el.innerText).includes(norm));
      if (!row || row.querySelector('.ctx-chat-nick')) continue;

      row.style.display = row.style.display || 'flex';
      row.style.alignItems = row.style.alignItems || 'center';
      row.style.gap = row.style.gap || '8px';

      const nick = document.createElement('span');
      nick.className = 'ctx-chat-nick';
      nick.textContent = info.nick;
      nick.style.cssText = `margin-left:auto;margin-right:8px;font-weight:700;color:${info.color};text-shadow:0 1px 2px rgba(0,0,0,.8);font-size:.9em;white-space:nowrap;`;
      const children = Array.from(row.children);
      const last = children[children.length - 1];
      if (last) row.insertBefore(nick, last); else row.appendChild(nick);
    }
  }

  document.addEventListener('submit', function (e) {
    if (e.isTrusted) {
      // bloqueia submit real para não voltar para tela inicial
      e.preventDefault();
      e.stopPropagation();
      log('submit real bloqueado');
    }
  }, true);

  updatePanel('Iniciando...');
  startWebSocket();
  setInterval(async () => { await poll(); await processQueue(); injectNicks(); }, POLL_MS);
  setInterval(injectNicks, 1500);
})();
