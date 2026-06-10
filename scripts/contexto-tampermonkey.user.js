// ==UserScript==
// @name         Contexto Chat Nick no Quadrinho
// @namespace    https://chatgpt.com/
// @version      1.0.0
// @description  Recebe palavras do Render, envia no Contexto e injeta nick colorido na linha da palavra.
// @match        https://contexto.me/*
// @match        https://*.contexto.me/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // TROQUE PELO LINK DO SEU RENDER, SEM BARRA NO FINAL.
  // Exemplo: const RENDER_URL = 'https://contexto-chat-render.onrender.com';
  const RENDER_URL = 'COLE_AQUI_O_LINK_DO_RENDER';

  const AUTO_SEND_TO_GAME = true;
  const SEND_DELAY_MS = 900;

  if (!RENDER_URL || RENDER_URL.includes('COLE_AQUI')) {
    console.warn('[Contexto Chat] Edite RENDER_URL no script Tampermonkey.');
    return;
  }

  const guessByWord = new Map();
  const queue = [];
  let busy = false;

  const style = document.createElement('style');
  style.textContent = `
    .cc-nick-badge{
      display:inline-flex!important;
      align-items:center!important;
      margin-left:auto!important;
      margin-right:10px!important;
      font-weight:800!important;
      font-size:0.92em!important;
      text-shadow:0 1px 2px rgba(0,0,0,.35)!important;
      max-width:140px!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
    }
    .cc-row-marked{
      display:flex!important;
      align-items:center!important;
      gap:8px!important;
    }
  `;
  document.documentElement.appendChild(style);

  function wsUrl() {
    return RENDER_URL.replace(/^http/, 'ws');
  }

  function normalize(s) {
    return String(s || '').trim().toLowerCase();
  }

  function connect() {
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => console.log('[Contexto Chat] conectado no Render');
    ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type === 'hello' && Array.isArray(data.recent)) return;
      if (data.type !== 'guess') return;
      receiveGuess(data);
    };
    ws.onclose = () => setTimeout(connect, 2500);
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function receiveGuess(data) {
    const word = normalize(data.word);
    if (!word) return;
    guessByWord.set(word, data);
    queue.push(data);
    processQueue();
  }

  async function processQueue() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const guess = queue.shift();
      if (AUTO_SEND_TO_GAME) sendWordToContexto(guess.word);
      await wait(SEND_DELAY_MS);
      injectNickForWord(guess.word);
    }
    busy = false;
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function sendWordToContexto(word) {
    const input = findInput();
    if (!input) {
      console.warn('[Contexto Chat] Campo de texto não encontrado.');
      return;
    }
    input.focus();
    input.value = word;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
  }

  function findInput() {
    const all = [...document.querySelectorAll('input, textarea')];
    return all.find(el => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type !== 'text' && type !== 'search' && el.tagName !== 'TEXTAREA') return false;
      if (el.disabled || el.readOnly) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 80 && rect.height > 15;
    });
  }

  function findRowForWord(word) {
    const target = normalize(word);
    const nodes = [...document.querySelectorAll('body *')].filter(el => {
      if (el.children.length > 6) return false;
      const t = normalize(el.textContent);
      return t === target || t.startsWith(target + ' ') || t.includes('\n' + target);
    });

    for (const el of nodes) {
      let row = el;
      for (let i = 0; i < 5 && row; i++, row = row.parentElement) {
        const txt = normalize(row.textContent);
        const hasWord = txt.includes(target);
        const hasNumber = /\b\d{1,6}\b/.test(txt);
        const rect = row.getBoundingClientRect();
        if (hasWord && hasNumber && rect.width > 120 && rect.height > 15) return row;
      }
    }
    return null;
  }

  function injectNickForWord(word) {
    const data = guessByWord.get(normalize(word));
    if (!data) return;

    const row = findRowForWord(word);
    if (!row) {
      setTimeout(() => injectNickForWord(word), 600);
      return;
    }

    row.classList.add('cc-row-marked');
    let badge = row.querySelector('.cc-nick-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cc-nick-badge';

      // tenta colocar antes do último número/rank; se não conseguir, coloca no fim
      const children = [...row.children];
      const numberChild = children.reverse().find(ch => /^\s*#?\d{1,6}\s*$/.test(ch.textContent || ''));
      if (numberChild) row.insertBefore(badge, numberChild);
      else row.appendChild(badge);
    }
    badge.textContent = data.nick;
    badge.style.color = data.color || '#00d5ff';
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const mo = new MutationObserver(() => {
    for (const [word] of guessByWord) injectNickForWord(word);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  connect();
})();
