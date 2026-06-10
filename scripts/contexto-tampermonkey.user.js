// ==UserScript==
// @name         Contexto Chat Render - Nick no quadrinho
// @namespace    contexto-chat-render
// @version      1.9.0
// @description  Recebe nick/palavra/cor do Render e mantém 1 nick dentro de cada quadrinho da palavra no Contexto, sem duplicar e recupera recentes do Render.
// @match        https://contexto.me/*
// @match        https://www.contexto.me/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // TROQUE PELO SEU LINK DO RENDER, SEM BARRA NO FINAL
  const RENDER_URL = 'https://contexto-o77j.onrender.com';

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

  // Histórico persistente: cada palavra enviada mantém nick/cor para reinserir depois que o Contexto rerenderizar a lista.
  const historyKey = 'contextoChatNickHistory_v17';
  let nickHistory = loadNickHistory();

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


  async function importRecentFromStatus() {
    if (!baseUrl() || baseUrl().includes('COLE_AQUI')) return;
    try {
      const data = await httpGet(`${baseUrl()}/api/status?t=${Date.now()}`);
      const recent = Array.isArray(data.recent) ? data.recent : [];
      for (const item of recent) {
        if (!item || item.type !== 'guess' || !item.word || !item.nick) continue;
        addNickHistory({
          id: item.id || `${item.nick}:${item.word}:${item.time || ''}`,
          nick: item.nick || 'chat',
          color: item.color || '#ffffff',
          word: item.word,
          norm: normalizeWord(item.word),
          time: item.time || Date.now()
        });
      }
    } catch (e) {
      log('status recente falhou', e && e.message ? e.message : e);
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

    addNickHistory({
      id: item.id || String(Date.now()),
      nick: item.nick || 'chat',
      color: item.color || '#ffffff',
      word,
      norm: normalizeWord(word),
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

  function rowTextWithoutOurNick(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll && clone.querySelectorAll('.ctx-chat-nick').forEach(n => n.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function looksLikeRankRow(el, wordNorm) {
    if (!visible(el)) return false;
    if (el.querySelector('input, textarea, iframe, video, canvas')) return false;
    if (el.classList && el.classList.contains('ctx-chat-nick')) return false;

    const r = el.getBoundingClientRect();
    const txt = rowTextWithoutOurNick(el);
    const norm = normalizeWord(txt);

    // Evita pegar tela inteira, container pai, tutorial, anúncios etc.
    if (r.width < 180 || r.width > 760) return false;
    if (r.height < 22 || r.height > 72) return false;
    if (txt.length < 3 || txt.length > 140) return false;
    if (!/\d{1,6}\s*$/.test(txt)) return false;

    // Linha do Contexto é basicamente: palavra ... número. Aceita a palavra no começo da linha.
    // Isso corrige casos em que o nick antigo ou o destaque mudam o texto interno.
    const startRe = new RegExp(`^\\s*${escapeRegex(wordNorm)}(\\s|$)`, 'i');
    const separateRe = new RegExp(`(^|\\s)${escapeRegex(wordNorm)}(\\s|$|\\d)`, 'i');
    return startRe.test(norm) || separateRe.test(norm);
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

  function loadNickHistory() {
    try {
      const arr = JSON.parse(localStorage.getItem(historyKey) || '[]');
      return Array.isArray(arr) ? arr.filter(x => x && x.word && x.nick).slice(-250) : [];
    } catch (_) {
      return [];
    }
  }

  function saveNickHistory() {
    try { localStorage.setItem(historyKey, JSON.stringify(nickHistory.slice(-250))); } catch (_) {}
  }

  function addNickHistory(info) {
    if (!info || !info.word || !info.nick) return;
    info.norm = info.norm || normalizeWord(info.word);
    info.time = info.time || Date.now();

    // Evita repetir a mesma mensagem recebida duas vezes pelo WebSocket + polling/status.
    if (info.id) {
      const i = nickHistory.findIndex(x => x.id === info.id);
      if (i >= 0) {
        nickHistory[i] = Object.assign({}, nickHistory[i], info);
        saveNickHistory();
        return;
      }
    }
    nickHistory.push(info);
    if (nickHistory.length > 400) nickHistory = nickHistory.slice(-400);
    saveNickHistory();
  }

  function findAllRowsForWord(word) {
    const wordNorm = normalizeWord(word);
    if (!wordNorm) return [];
    const all = Array.from(document.querySelectorAll('div, li, tr, a, button'));
    let candidates = all.filter(el => looksLikeRankRow(el, wordNorm));
    if (!candidates.length) return [];

    // Remove pais quando também existe um filho candidato. Assim não mexe no container inteiro.
    let deepest = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));

    // Preferir linhas cujo texto começa com a palavra. Isso evita pegar wrapper pai quando existe anúncio/layout junto.
    const exactStart = deepest.filter(el => {
      const norm = normalizeWord(rowTextWithoutOurNick(el));
      return new RegExp(`^\\s*${escapeRegex(wordNorm)}(\\s|$)`, 'i').test(norm);
    });
    if (exactStart.length) deepest = exactStart;

    deepest.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) > 2) return ar.top - br.top;
      return ar.left - br.left;
    });
    return deepest;
  }

  function clearWrongFloatingNicks() {
    // Remove nicks que versões antigas possam ter deixado fora dos quadrinhos.
    for (const nick of Array.from(document.querySelectorAll('.ctx-chat-nick'))) {
      const row = nick.closest('div, li, tr, a, button');
      if (!row || !/\d{1,6}\s*$/.test(elementText(row))) nick.remove();
    }

    // Limpa duplicados que ficaram de versões anteriores: mantém apenas o primeiro
    // temporariamente; a função insertOrUpdateNickInsideRow vai recriar certo.
    const rows = Array.from(document.querySelectorAll('div, li, tr, a, button'));
    for (const row of rows) {
      const nicks = Array.from(row.querySelectorAll(':scope > .ctx-chat-nick, :scope .ctx-chat-nick'));
      if (nicks.length > 1) nicks.slice(1).forEach(n => n.remove());
    }
  }

  function insertOrUpdateNickInsideRow(row, info, slot) {
    if (!row || !info) return false;

    // CORREÇÃO: o Contexto recria/reorganiza elementos e versões anteriores podiam
    // deixar 2+ spans do nick na mesma linha. Antes de inserir, limpa todos os nicks
    // que já estão dentro desse quadrinho. Resultado: sempre fica só 1 nick por linha.
    for (const oldNick of Array.from(row.querySelectorAll('.ctx-chat-nick'))) {
      oldNick.remove();
    }

    const nick = document.createElement('span');
    nick.className = 'ctx-chat-nick';
    nick.dataset.ctxSlot = String(slot);
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
      'margin-right:8px',
      'pointer-events:none'
    ].join(';');

    const rankEl = findRankElement(row);
    if (rankEl && rankEl.parentElement && row.contains(rankEl)) {
      rankEl.parentElement.insertBefore(nick, rankEl);
      return true;
    }

    // Fallback seguro: ainda fica dentro da própria linha, nunca solto na tela.
    row.appendChild(nick);
    return true;
  }

  function injectNicks() {
    clearWrongFloatingNicks();

    const now = Date.now();
    // Mantém histórico por um bom tempo, porque o Contexto recria as linhas e apaga alterações antigas.
    nickHistory = nickHistory.filter(x => now - (x.time || 0) < 6 * 60 * 60 * 1000);

    const groups = new Map();
    for (const info of nickHistory) {
      const norm = info.norm || normalizeWord(info.word);
      if (!norm) continue;
      if (!groups.has(norm)) groups.set(norm, []);
      groups.get(norm).push(info);
    }

    for (const infos of groups.values()) {
      // Mais recentes primeiro, porque a linha destacada/nova costuma aparecer acima.
      infos.sort((a, b) => (b.time || 0) - (a.time || 0));
      const rows = findAllRowsForWord(infos[0].word);
      rows.forEach((row, idx) => {
        const info = infos[idx] || infos[0];
        insertOrUpdateNickInsideRow(row, info, idx);
      });
    }

    saveNickHistory();
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
  setInterval(async () => { await importRecentFromStatus(); injectNicks(); }, 2500);
  setInterval(injectNicks, 1000);
})();
