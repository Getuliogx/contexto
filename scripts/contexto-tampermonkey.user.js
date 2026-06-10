// ==UserScript==
// @name         Contexto Chat Nick no Quadrinho - envio corrigido
// @namespace    https://chatgpt.com/
// @version      1.2.0
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

  // Mais lento para o Contexto terminar o "calculando" antes da próxima palavra.
  const DELAY_AFTER_SEND_MS = 3200;
  const MAX_WAIT_CALCULATING_MS = 12000;
  const IGNORE_OLD_QUEUE_ON_OPEN = true; // evita jogar palavras antigas quando abre/recarrega a aba

  if (!RENDER_URL || RENDER_URL.includes('COLE_AQUI')) {
    console.warn('[Contexto Chat] Edite RENDER_URL no script Tampermonkey.');
    return;
  }

  const guessByWord = new Map();
  const queue = [];
  const sentWords = new Set();
  let busy = false;
  let connectedOnce = false;

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
      max-width:150px!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      flex:0 0 auto!important;
    }
    .cc-row-marked{
      display:flex!important;
      align-items:center!important;
      gap:8px!important;
    }
    #cc-status-mini{
      position:fixed!important;
      right:10px!important;
      bottom:10px!important;
      z-index:999999!important;
      background:rgba(0,0,0,.75)!important;
      color:#fff!important;
      padding:6px 9px!important;
      border-radius:8px!important;
      font:12px Arial,sans-serif!important;
      pointer-events:none!important;
    }
  `;
  document.documentElement.appendChild(style);

  const mini = document.createElement('div');
  mini.id = 'cc-status-mini';
  mini.textContent = 'Contexto Chat: iniciando...';
  document.documentElement.appendChild(mini);

  function setMini(text) {
    mini.textContent = 'Contexto Chat: ' + text;
    console.log('[Contexto Chat]', text);
  }

  function wsUrl() {
    return RENDER_URL.replace(/^http/, 'ws');
  }

  function normalize(s) {
    return String(s || '').trim().toLowerCase();
  }

  function connect() {
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      setMini('conectado no Render');
      connectedOnce = true;
    };
    ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }

      // Não joga fila antiga ao abrir a aba, só guarda nick/cor para injetar se a linha já existir.
      if (data.type === 'hello' && Array.isArray(data.recent)) {
        data.recent.forEach(g => {
          if (g && g.word) guessByWord.set(normalize(g.word), g);
        });
        if (!IGNORE_OLD_QUEUE_ON_OPEN) data.recent.forEach(receiveGuess);
        return;
      }

      if (data.type !== 'guess') return;
      receiveGuess(data);
    };
    ws.onclose = () => {
      setMini('desconectado, reconectando...');
      setTimeout(connect, 2500);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function receiveGuess(data) {
    const word = normalize(data.word);
    if (!word) return;
    guessByWord.set(word, data);
    if (!sentWords.has(word)) queue.push(data);
    processQueue();
  }

  async function processQueue() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const guess = queue.shift();
      const word = normalize(guess.word);
      if (!word || sentWords.has(word)) continue;

      await waitUntilNotCalculating();
      const before = document.body.innerText;
      let ok = true;
      if (AUTO_SEND_TO_GAME) ok = await sendWordToContexto(guess.word);
      sentWords.add(word);

      setMini(ok ? `enviou: ${guess.word}` : `falhou ao enviar: ${guess.word}`);
      await waitForWordToAppear(word, before);
      injectNickForWord(word);
      await wait(DELAY_AFTER_SEND_MS);
    }
    busy = false;
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isCalculating() {
    const text = normalize(document.body.innerText);
    return text.includes('calculando') || text.includes('calculating');
  }

  async function waitUntilNotCalculating() {
    const start = Date.now();
    while (isCalculating() && Date.now() - start < MAX_WAIT_CALCULATING_MS) {
      setMini('aguardando cálculo terminar...');
      await wait(350);
    }
  }

  async function waitForWordToAppear(word, beforeText) {
    const start = Date.now();
    const target = normalize(word);
    while (Date.now() - start < MAX_WAIT_CALCULATING_MS) {
      const row = findRowForWord(target);
      if (row) return true;
      if (!isCalculating() && normalize(document.body.innerText).includes(target)) return true;
      await wait(400);
    }
    return false;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor.set.call(el, value);
  }

  async function sendWordToContexto(word) {
    const input = findInput();
    if (!input) {
      setMini('campo não encontrado');
      return false;
    }

    input.focus();
    input.click();
    setNativeValue(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    await wait(80);

    setNativeValue(input, word);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: word }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(120);

    // 1) Enter realista
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await wait(250);

    // 2) Botão de submit, se existir
    const btn = findSubmitButton(input);
    if (btn) {
      btn.click();
      await wait(250);
    }

    // 3) requestSubmit no form, se existir
    const form = input.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        try { form.requestSubmit(btn || undefined); } catch { form.requestSubmit(); }
      } else {
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: btn || null }));
      }
    }

    return true;
  }

  function findInput() {
    const all = [...document.querySelectorAll('input, textarea')];
    return all.find(el => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type !== 'text' && type !== 'search' && el.tagName !== 'TEXTAREA') return false;
      if (el.disabled || el.readOnly) return false;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 60 && rect.height > 10 && getComputedStyle(el).visibility !== 'hidden';
      return visible;
    });
  }

  function findSubmitButton(input) {
    const form = input.closest('form');
    const candidates = [
      ...(form ? [...form.querySelectorAll('button, input[type="submit"]')] : []),
      ...[...document.querySelectorAll('button, input[type="submit"]')]
    ];
    return candidates.find(btn => {
      if (btn.disabled) return false;
      const rect = btn.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return false;
      const text = normalize(btn.textContent || btn.value || btn.getAttribute('aria-label') || '');
      return text.includes('enviar') || text.includes('send') || text.includes('ok') || btn.type === 'submit' || btn.tagName === 'BUTTON';
    });
  }

  function findRowForWord(word) {
    const target = normalize(word);
    const nodes = [...document.querySelectorAll('body *')].filter(el => {
      if (el.id === 'cc-status-mini') return false;
      if (el.children.length > 8) return false;
      const t = normalize(el.textContent);
      return t === target || t.startsWith(target + ' ') || t.includes('\n' + target) || t.includes(target + '\n');
    });

    for (const el of nodes) {
      let row = el;
      for (let i = 0; i < 6 && row && row !== document.body; i++, row = row.parentElement) {
        const txt = normalize(row.textContent);
        const hasWord = txt.includes(target);
        const hasNumber = /\b\d{1,6}\b/.test(txt);
        const rect = row.getBoundingClientRect();
        if (hasWord && hasNumber && rect.width > 120 && rect.height > 14) return row;
      }
    }
    return null;
  }

  function injectNickForWord(word) {
    const data = guessByWord.get(normalize(word));
    if (!data) return;

    const row = findRowForWord(word);
    if (!row) return;

    row.classList.add('cc-row-marked');
    let badge = row.querySelector('.cc-nick-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cc-nick-badge';

      const children = [...row.children];
      const numberChild = children.reverse().find(ch => /^\s*#?\d{1,6}\s*$/.test(ch.textContent || ''));
      if (numberChild) row.insertBefore(badge, numberChild);
      else row.appendChild(badge);
    }
    badge.textContent = data.nick || data.username || 'chat';
    badge.style.color = data.color || '#00d5ff';
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const mo = new MutationObserver(() => {
    for (const [word] of guessByWord) injectNickForWord(word);
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  connect();
})();
