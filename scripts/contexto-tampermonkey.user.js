// ==UserScript==
// @name         Contexto Chat Render - Nick no quadrinho
// @namespace    contexto-chat-render
// @version      1.6.0
// @description  Recebe nick/palavra/cor do Render e coloca o nick dentro do quadrinho correto do Contexto, sem jogar nada para o canto.
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

  let lastId = localStorage.getItem('contextoChatLastId_v16') || '';
  let queue = [];
  let sending = false;
  let ws = null;
  let receivedCount = 0;
  let sentCount = 0;

  // palavra normalizada -> dados do nick
  const pendingByWord = new Map();

  function baseUrl() { return String(RENDER_URL || '').replace(/\/$/, ''); }
  function log(...args) { if (DEBUG) console.log('[Contexto Chat]', ...args); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function escapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function enqueue(item, origin) {
    if (!item || (item.type && item.type !== 'guess')) return;
    if (!item.id || !item.word) return;
    if (item.id === lastId) return;
    if (queue.some(x => x.id === item.id)) return;

    lastId = item.id;
    localStorage.setItem('contextoChatLastId_v16', lastId);
    queue.push(item);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    receivedCount++;
    log('recebido via', origin, item);
  }

  function startWebSocket() {
    if (!baseUrl() || baseUrl().includes('COLE_AQUI')) {
      console.warn('[Contexto Chat] Coloque o link do Render no RENDER_URL do script.');
      return;
    }
    try {
      const wsUrl = baseUrl().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => log('websocket conectado');
      ws.onclose = () => setTimeout(startWebSocket, 3000);
      ws.onerror = () => log('websocket erro, polling continua funcionando');
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'hello') {
            const recent = Array.isArray(data.recent) ? data.recent : [];
            if (!lastId && recent.length) {
              lastId = recent[recent.length - 1].id;
              localStorage.setItem('contextoChatLastId_v16', lastId);
            }
            return;
          }
          enqueue(data, 'websocket');
        } catch (e) { log('ws json erro', e); }
      };
    } catch (e) {
      log('ws falhou', e);
    }
  }

  async function poll() {
    if (!baseUrl() || baseUrl().includes('COLE_AQUI')) return;
    try {
      const data = await httpGet(`${baseUrl()}/api/queue?after=${encodeURIComponent(lastId || '')}&t=${Date.now()}`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (!lastId && data.latestId) {
        lastId = data.latestId;
        localStorage.setItem('contextoChatLastId_v16', lastId);
      }
      for (const item of items) enqueue(item, 'polling');
    } catch (e) {
      log('poll falhou', e && e.message ? e.message : e);
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

  function fireSyntheticSubmit(el) {
    const form = el.closest('form');
    if (!form) return false;
    let ev;
    try { ev = new SubmitEvent('submit', { bubbles: true, cancelable: true }); }
    catch (_) { ev = new Event('submit', { bubbles: true, cancelable: true }); }
    form.dispatchEvent(ev);
    ev.preventDefault();
    return true;
  }

  async function sendToContexto(item) {
    const word = String(item.word || '').trim();
    if (!word) return false;
    const input = getInput();
    if (!input) { log('não achei input'); return false; }

    fireInputEvents(input, word);
    await sleep(120);
    fireEnter(input);
    await sleep(220);
    fireSyntheticSubmit(input);
    await sleep(250);
    fireEnter(input);

    pendingByWord.set(normalizeWord(word), {
      nick: item.nick || 'chat',
      color: item.color || '#ffffff',
      word,
      time: Date.now()
    });
    sentCount++;
    log('enviado', word, item.nick, 'recebidas', receivedCount, 'enviadas', sentCount);
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
    finally { sending = false; }
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
  }

  function elementText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function looksLikeRankRow(el, wordNorm) {
    if (!visible(el)) return false;
    if (el.querySelector('input, textarea, iframe, video, canvas')) return false;
    if (el.classList && el.classList.contains('ctx-chat-nick')) return false;

    const r = el.getBoundingClientRect();
    const txt = elementText(el);
    const norm = normalizeWord(txt);

    // Evita pegar tela inteira, container pai, tutorial, anúncios etc.
    if (r.width < 180 || r.width > 760) return false;
    if (r.height < 22 || r.height > 72) return false;
    if (txt.length < 3 || txt.length > 140) return false;
    if (!norm.includes(wordNorm)) return false;
    if (!/\d{1,6}\s*$/.test(txt)) return false;

    // Precisa ter a palavra como pedaço separado, não só escondida em frase grande.
    const re = new RegExp(`(^|\\s)${escapeRegex(wordNorm)}(\\s|$|\\d)`, 'i');
    return re.test(norm);
  }

  function findBestRow(word) {
    const wordNorm = normalizeWord(word);
    if (!wordNorm) return null;

    const all = Array.from(document.querySelectorAll('div, li, tr, a, button'));
    const candidates = all.filter(el => looksLikeRankRow(el, wordNorm));
    if (!candidates.length) return null;

    // Pega o elemento mais profundo e menor. Isso evita jogar o nick fora da linha.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const areaA = ar.width * ar.height;
      const areaB = br.width * br.height;
      const depthA = getDepth(a);
      const depthB = getDepth(b);
      if (depthA !== depthB) return depthB - depthA;
      return areaA - areaB;
    });
    return candidates[0];
  }

  function getDepth(el) {
    let d = 0;
    while (el && el.parentElement) { d++; el = el.parentElement; }
    return d;
  }

  function findRankElement(row) {
    const kids = Array.from(row.querySelectorAll(':scope > *')).filter(visible);
    const directRank = kids.find(el => /^#?\d{1,6}$/.test(elementText(el)));
    if (directRank) return directRank;

    const all = Array.from(row.querySelectorAll('*')).filter(visible);
    const exact = all.find(el => /^#?\d{1,6}$/.test(elementText(el)));
    if (exact) return exact;

    return null;
  }

  function insertNickInsideRow(row, info) {
    if (!row || row.querySelector('.ctx-chat-nick')) return false;

    const nick = document.createElement('span');
    nick.className = 'ctx-chat-nick';
    nick.textContent = info.nick;
    nick.title = `${info.nick} mandou: ${info.word}`;
    nick.style.cssText = [
      'color:' + (info.color || '#fff'),
      'font-weight:700',
      'font-size:.88em',
      'line-height:1',
      'white-space:nowrap',
      'text-shadow:0 1px 2px rgba(0,0,0,.75)',
      'display:inline-block',
      'vertical-align:middle',
      'max-width:120px',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'margin-left:8px',
      'margin-right:8px'
    ].join(';');

    const rankEl = findRankElement(row);
    if (rankEl && rankEl.parentElement) {
      rankEl.parentElement.insertBefore(nick, rankEl);
      return true;
    }

    // Fallback: não cria nada fora do quadrinho. Só coloca no fim da própria linha.
    row.appendChild(nick);
    return true;
  }

  function injectNicks() {
    const now = Date.now();
    for (const [norm, info] of Array.from(pendingByWord.entries())) {
      if (now - info.time > 10 * 60 * 1000) {
        pendingByWord.delete(norm);
        continue;
      }
      const row = findBestRow(info.word);
      if (!row) continue;
      if (insertNickInsideRow(row, info)) {
        pendingByWord.delete(norm);
        log('nick inserido dentro do quadrinho:', info.nick, info.word);
      }
    }
  }

  // Bloqueia submit real que causava volta para a tela inicial, mas não cria painel nem mexe no layout.
  document.addEventListener('submit', function (e) {
    if (e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      log('submit real bloqueado');
    }
  }, true);

  startWebSocket();
  setInterval(async () => { await poll(); await processQueue(); injectNicks(); }, POLL_MS);
  setInterval(injectNicks, 1000);
})();
