// ==UserScript==
// @name         Contexto Chat Render - FINAL corrigido
// @namespace    contexto-chat-render
// @version      5.0.0
// @description  Recebe palavras do chat pelo Render, envia para o Contexto e coloca o nick colorido dentro do quadrinho certo.
// @match        https://contexto.me/*
// @match        https://www.contexto.me/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // COLE O LINK DO RENDER AQUI, SEM BARRA NO FINAL
  const RENDER_URL = 'COLE_AQUI_O_LINK_DO_RENDER';

  const POLL_MS = 900;
  const BETWEEN_WORDS_MS = 1500;
  const WAIT_RESULT_MS = 6500;
  const STORAGE_LAST_ID = 'ctxChat_final_lastId_v50';
  const STORAGE_HISTORY = 'ctxChat_final_history_v50';
  const STORAGE_FAILSAFE_LAST_ID = 'ctxChat_lastId_v20'; // aproveita última versão que recebia certo
  const DEBUG = true;

  let lastId = localStorage.getItem(STORAGE_LAST_ID) || localStorage.getItem(STORAGE_FAILSAFE_LAST_ID) || '';
  let queue = [];
  let sending = false;
  let ws = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => DEBUG && console.log('[Contexto Chat FINAL]', ...a);
  const baseUrl = () => String(RENDER_URL || '').trim().replace(/\/+$/, '');

  function normalize(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}0-9'’.-]/gu, '');
  }

  function safeColor(c) {
    return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#ffd400';
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function saveHistory(h) {
    // h = { palavraNormalizada: [metas...] }
    const all = [];
    for (const [k, arr] of Object.entries(h)) {
      for (const meta of (Array.isArray(arr) ? arr : [arr])) all.push([k, meta]);
    }
    if (all.length > 600) {
      all.sort((a, b) => (a[1].time || 0) - (b[1].time || 0));
      const removeCount = all.length - 600;
      for (let i = 0; i < removeCount; i++) {
        const [k, meta] = all[i];
        if (!Array.isArray(h[k])) delete h[k];
        else {
          const idx = h[k].findIndex(x => x.id === meta.id && x.time === meta.time);
          if (idx >= 0) h[k].splice(idx, 1);
          if (!h[k].length) delete h[k];
        }
      }
    }
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(h));
  }

  function remember(item) {
    if (!item) return;
    const word = String(item.word || item.palavra || item.text || item.message || '').trim();
    const key = normalize(word);
    if (!key) return;

    const meta = {
      id: String(item.id || item.messageId || item.message_id || `${Date.now()}-${Math.random()}`),
      word,
      nick: String(item.nick || item.username || item.user || item.displayName || item.display_name || 'CHAT').trim() || 'CHAT',
      color: safeColor(item.color || item.colour || item.userColor || item.user_color),
      time: Date.now()
    };

    const h = loadHistory();
    if (!Array.isArray(h[key])) h[key] = [];
    if (!h[key].some(x => x.id === meta.id)) h[key].push(meta);
    h[key].sort((a, b) => (a.time || 0) - (b.time || 0));
    saveHistory(h);
  }

  function httpGet(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 10000,
          onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); } },
          onerror: reject,
          ontimeout: reject
        });
      } else {
        fetch(url, { cache: 'no-store' }).then(r => r.json()).then(resolve).catch(reject);
      }
    });
  }

  function saveLastId(id) {
    lastId = id || lastId;
    localStorage.setItem(STORAGE_LAST_ID, lastId);
    localStorage.setItem(STORAGE_FAILSAFE_LAST_ID, lastId);
  }

  function enqueue(item, origin) {
    if (!item || item.type !== 'guess' || !item.id || !item.word) return;
    if (String(item.id) === String(lastId)) return;
    if (queue.some(x => String(x.id) === String(item.id))) return;

    remember(item);
    saveLastId(String(item.id));
    queue.push(item);
    log('recebido', origin, item.nick, item.word);
    annotateAllRowsSoon();
  }

  function startWs() {
    const url = baseUrl();
    if (!url || url.includes('COLE_AQUI')) {
      console.error('[Contexto Chat FINAL] Você precisa colocar o link do Render em RENDER_URL.');
      return;
    }

    function connect(wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => log('WebSocket OK:', wsUrl);
        ws.onclose = () => setTimeout(() => connect(wsUrl), 3000);
        ws.onerror = () => {};
        ws.onmessage = ev => {
          try {
            const data = JSON.parse(ev.data);
            if (data.type === 'hello') {
              const recent = Array.isArray(data.recent) ? data.recent : [];
              for (const it of recent) remember(it);
              if (!lastId && recent.length) saveLastId(String(recent[recent.length - 1].id));
              annotateAllRowsSoon();
              return;
            }
            enqueue(data, 'ws');
          } catch (e) { log('erro ws', e); }
        };
      } catch (e) { log('ws falhou', e); }
    }

    // O servidor do pacote usa WebSocket na raiz. Não usa /ws.
    const wsUrl = url.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    connect(wsUrl);
  }

  async function poll() {
    const url = baseUrl();
    if (!url || url.includes('COLE_AQUI')) return;
    try {
      const data = await httpGet(`${url}/api/queue?after=${encodeURIComponent(lastId || '')}&t=${Date.now()}`);
      if (!lastId && data.latestId) saveLastId(String(data.latestId));
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) enqueue(item, 'poll');
    } catch (e) {
      log('poll falhou', e && e.message ? e.message : e);
    }
  }

  function getInput() {
    const all = Array.from(document.querySelectorAll('input, textarea'));
    return all.find(el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (el.disabled || el.readOnly) return false;
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      if (r.width < 250 || r.height < 30) return false;
      return true;
    }) || all.find(el => !el.disabled && !el.readOnly) || null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function reactProps(el) {
    const k = Object.keys(el).find(x => x.startsWith('__reactProps$') || x.startsWith('__reactEventHandlers$'));
    return k ? el[k] : null;
  }

  function fillInput(el, value) {
    el.focus();
    el.click();
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    setNativeValue(el, value);

    const inputEv = (() => {
      try { return new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value, composed: true }); }
      catch (_) { return new Event('input', { bubbles: true, cancelable: true, composed: true }); }
    })();
    el.dispatchEvent(inputEv);
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));

    const props = reactProps(el);
    if (props && typeof props.onChange === 'function') {
      try { props.onChange({ target: el, currentTarget: el, nativeEvent: inputEv, preventDefault(){}, stopPropagation(){} }); } catch (_) {}
    }
  }

  function fireEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13, bubbles: true, cancelable: true, composed: true };
    const props = reactProps(el);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      try { el.dispatchEvent(new KeyboardEvent(type, opts)); } catch (_) {}
    }
    if (props) {
      const fake = { ...opts, target: el, currentTarget: el, nativeEvent: {}, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){} };
      try { if (typeof props.onKeyDown === 'function') props.onKeyDown(fake); } catch (_) {}
      try { if (typeof props.onKeyPress === 'function') props.onKeyPress(fake); } catch (_) {}
      try { if (typeof props.onKeyUp === 'function') props.onKeyUp(fake); } catch (_) {}
    }
  }

  function fireSubmit(el) {
    const form = el.closest('form');
    if (!form) return;
    const ev = typeof SubmitEvent === 'function'
      ? new SubmitEvent('submit', { bubbles: true, cancelable: true, composed: true })
      : new Event('submit', { bubbles: true, cancelable: true, composed: true });
    form.dispatchEvent(ev); // não usa requestSubmit e não clica em botão, para não recarregar.

    const props = reactProps(form);
    if (props && typeof props.onSubmit === 'function') {
      try { props.onSubmit({ target: form, currentTarget: form, nativeEvent: ev, preventDefault(){}, stopPropagation(){} }); } catch (_) {}
    }
  }

  function clickSafeButtonNearInput(el) {
    // Só tenta botão dentro do mesmo form; evita menu, voltar, anúncio, três pontinhos etc.
    const form = el.closest('form');
    if (!form) return;
    const buttons = Array.from(form.querySelectorAll('button, input[type="submit"]')).filter(b => {
      const r = b.getBoundingClientRect();
      return !b.disabled && r.width > 5 && r.height > 5;
    });
    const b = buttons.find(x => (x.type || '').toLowerCase() === 'submit') || buttons[0];
    if (b) {
      try { b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })); } catch (_) {}
    }
  }

  function currentAttemptCount() {
    const txt = document.body.innerText || '';
    const m = txt.match(/TENTATIVAS:\s*(\d+)/i);
    return m ? Number(m[1]) : NaN;
  }

  async function sendWord(item) {
    const word = String(item.word || '').trim();
    if (!word) return false;

    remember(item);
    const input = getInput();
    if (!input) { log('campo do Contexto não encontrado'); return false; }

    const beforeAttempts = currentAttemptCount();
    const beforeRows = resultRows().length;

    fillInput(input, word);
    await sleep(80);
    fireEnter(input);
    await sleep(180);
    fireSubmit(input);
    await sleep(180);

    // Se ainda estiver no campo, tenta Enter de novo. Não usa requestSubmit.
    if (String(input.value || '').trim().toLowerCase() === word.toLowerCase()) {
      fireEnter(input);
      await sleep(220);
      fireSubmit(input);
      await sleep(220);
    }

    // Último fallback seguro: botão dentro do form, se existir.
    if (String(input.value || '').trim().toLowerCase() === word.toLowerCase()) {
      clickSafeButtonNearInput(input);
    }

    const start = Date.now();
    while (Date.now() - start < WAIT_RESULT_MS) {
      annotateAllRows();
      const found = resultRows().some(row => parseRow(row).wordNorm === normalize(word));
      const afterAttempts = currentAttemptCount();
      if (found || resultRows().length > beforeRows || (!Number.isNaN(beforeAttempts) && afterAttempts > beforeAttempts)) {
        annotateAllRows();
        return true;
      }
      await sleep(250);
    }

    // Não apaga o campo à força; só avisa no console para não esconder erro do Contexto.
    log('não confirmou envio no Contexto:', word);
    annotateAllRows();
    return false;
  }

  async function processQueue() {
    if (sending || !queue.length) return;
    sending = true;
    try {
      const item = queue.shift();
      await sendWord(item);
      await sleep(BETWEEN_WORDS_MS);
      annotateAllRows();
    } catch (e) {
      console.error('[Contexto Chat FINAL]', e);
    } finally {
      sending = false;
    }
  }

  function ensureStyle() {
    if (document.getElementById('ctx-chat-final-style')) return;
    const style = document.createElement('style');
    style.id = 'ctx-chat-final-style';
    style.textContent = `
      .ctx-chat-final-nick {
        position: absolute !important;
        right: 76px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        font-weight: 900 !important;
        font-size: 14px !important;
        line-height: 1 !important;
        max-width: 155px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        text-shadow: 0 1px 2px rgba(0,0,0,.95), 0 0 4px rgba(0,0,0,.95) !important;
        font-family: inherit !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function textWithoutNick(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.ctx-chat-final-nick').forEach(n => n.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parseRow(el) {
    const txt = textWithoutNick(el);
    if (!txt) return { word: '', wordNorm: '', rank: '' };
    const low = txt.toLowerCase();
    if (low.includes('tentativas') || low.includes('contexto') || low.includes('digite uma palavra')) return { word: '', wordNorm: '', rank: '' };
    if (low.includes('essa palavra') || low.includes('não vale') || low.includes('como jogar') || low.includes('tutorial')) return { word: '', wordNorm: '', rank: '' };
    if (/\d{2}\/\d{2}\/\d{4}/.test(txt)) return { word: '', wordNorm: '', rank: '' };

    // Quadrinho do Contexto: palavra + número no final. Pega uma única palavra como chute.
    const m = txt.match(/^([\p{L}][\p{L}'’.-]{0,70})\s+(\d{1,7})$/u);
    if (!m) return { word: '', wordNorm: '', rank: '' };
    return { word: m[1], wordNorm: normalize(m[1]), rank: m[2] };
  }

  function visibleRowLike(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('input, textarea, form, header, nav, iframe, script, style, svg, canvas, video')) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (r.width < 250 || r.width > 820 || r.height < 24 || r.height > 85) return false;
    if (r.bottom < 0 || r.top > innerHeight) return false;
    return true;
  }

  function candidateRows() {
    const all = Array.from(document.querySelectorAll('body *'));
    const candidates = [];
    for (const el of all) {
      if (!visibleRowLike(el)) continue;
      const p = parseRow(el);
      if (!p.wordNorm || !p.rank) continue;
      const r = el.getBoundingClientRect();
      candidates.push({ el, parsed: p, area: r.width * r.height, top: Math.round(r.top) });
    }

    // Mantém o candidato mais largo/externo para cada palavra+rank+posição vertical.
    const byLine = new Map();
    for (const c of candidates) {
      const k = `${c.parsed.wordNorm}|${c.parsed.rank}|${Math.round(c.top / 3)}`;
      const old = byLine.get(k);
      if (!old || c.area > old.area) byLine.set(k, c);
    }
    return Array.from(byLine.values()).sort((a, b) => a.top - b.top);
  }

  function resultRows() {
    return candidateRows().map(x => x.el);
  }

  function metaForRow(wordNorm, occurrenceIndex) {
    const h = loadHistory();
    const arr = h[wordNorm];
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[Math.min(occurrenceIndex, arr.length - 1)] || arr[arr.length - 1];
  }

  function annotateAllRows() {
    ensureStyle();
    const rows = candidateRows();
    const counts = Object.create(null);

    for (const { el, parsed } of rows) {
      const key = parsed.wordNorm;
      const idx = counts[key] || 0;
      counts[key] = idx + 1;
      const meta = metaForRow(key, idx);

      el.querySelectorAll(':scope > .ctx-chat-final-nick').forEach(n => n.remove());
      if (!meta) continue; // palavra manual ou sem histórico do chat: não inventa nick.

      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      if (getComputedStyle(el).overflow === 'hidden') el.style.overflow = 'visible';

      const nick = document.createElement('span');
      nick.className = 'ctx-chat-final-nick';
      nick.textContent = meta.nick || 'CHAT';
      nick.title = meta.nick || 'CHAT';
      nick.style.color = safeColor(meta.color);
      el.appendChild(nick);
    }
  }

  let annTimer = null;
  function annotateAllRowsSoon() {
    clearTimeout(annTimer);
    annTimer = setTimeout(annotateAllRows, 80);
  }

  // Impede recarregamento nativo, mas NÃO usa stopPropagation para não bloquear o React/Vue do jogo.
  document.addEventListener('submit', (e) => {
    if (location.hostname.includes('contexto.me')) e.preventDefault();
  }, true);

  const observer = new MutationObserver(() => annotateAllRowsSoon());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  startWs();
  setInterval(async () => {
    await poll();
    await processQueue();
    annotateAllRows();
  }, POLL_MS);
  setInterval(annotateAllRows, 500);
})();
