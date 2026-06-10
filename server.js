const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const tmi = require('tmi.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 10000;
const TWITCH_CHANNEL = (process.env.TWITCH_CHANNEL || '').replace(/^@/, '').trim().toLowerCase();
const ACCEPT_ALL_MESSAGES = String(process.env.ACCEPT_ALL_MESSAGES || 'true').toLowerCase() === 'true';
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!c';
const MAX_WORD_LENGTH = Number(process.env.MAX_WORD_LENGTH || 35);
const IGNORE_COMMANDS = String(process.env.IGNORE_COMMANDS || 'true').toLowerCase() === 'true';
const ALLOW_NUMBERS = String(process.env.ALLOW_NUMBERS || 'false').toLowerCase() === 'true';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const recent = [];
const rawMessages = [];
const rejected = [];
const status = {
  startedAt: new Date().toISOString(),
  twitchChannel: TWITCH_CHANNEL || null,
  twitchConnected: false,
  twitchConnectionError: null,
  lastTwitchMessageAt: null,
  lastAcceptedAt: null,
  totalRaw: 0,
  totalAccepted: 0,
  totalRejected: 0,
  websocketClients: 0
};

function pushLimited(arr, item, max = 30) {
  arr.push(item);
  while (arr.length > max) arr.shift();
}

function safeText(v, max = 120) {
  return String(v || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripEdges(v) {
  return String(v || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function normalizeWord(v) {
  return stripEdges(safeText(v, MAX_WORD_LENGTH + 30)).toLowerCase();
}

function reject(reason, extra = {}) {
  status.totalRejected++;
  const item = { time: new Date().toISOString(), reason, ...extra };
  pushLimited(rejected, item, 40);
  console.log('[REJEITADO]', reason, extra);
  return null;
}

function isValidContextoWord(word) {
  if (!word) return 'vazio';
  if (word.length > MAX_WORD_LENGTH) return 'maior que MAX_WORD_LENGTH';
  if (/\s/.test(word)) return 'tem espaço/frase';
  if (/https?:\/\//i.test(word) || /^www\./i.test(word)) return 'link';
  if (word.startsWith('@') || word.startsWith('#')) return '@ ou #';
  if (!ALLOW_NUMBERS && /\p{N}/u.test(word)) return 'tem número e ALLOW_NUMBERS=false';
  if (!/^[\p{L}]+(?:[-'’][\p{L}]+)*$/u.test(word)) return 'não parece palavra';
  return '';
}

function sendAll(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
  status.websocketClients = [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length;
}

function addGuess({ nick, word, color, source }) {
  nick = safeText(nick, 32) || 'viewer';
  word = normalizeWord(word);
  color = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#00d5ff';
  source = safeText(source, 20) || 'manual';

  const invalidReason = isValidContextoWord(word);
  if (invalidReason) return reject(invalidReason, { nick, word, source });

  const payload = {
    type: 'guess',
    id: Date.now() + '-' + Math.random().toString(16).slice(2),
    nick,
    word,
    color,
    source,
    time: new Date().toISOString()
  };

  status.totalAccepted++;
  status.lastAcceptedAt = payload.time;
  pushLimited(recent, payload, 80);
  console.log('[ACEITO]', `${nick}: ${word}`, source, color);
  sendAll(payload);
  return payload;
}

wss.on('connection', (ws) => {
  status.websocketClients = [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length;
  ws.send(JSON.stringify({ type: 'hello', recent }));
  ws.on('close', () => {
    status.websocketClients = [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length;
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ...status, mode: ACCEPT_ALL_MESSAGES ? 'sem_comando' : 'com_prefixo', prefix: COMMAND_PREFIX, maxWordLength: MAX_WORD_LENGTH, ignoreCommands: IGNORE_COMMANDS, allowNumbers: ALLOW_NUMBERS });
});

app.get('/api/status', (req, res) => {
  res.json({ ok: true, status, config: { mode: ACCEPT_ALL_MESSAGES ? 'sem_comando' : 'com_prefixo', prefix: COMMAND_PREFIX, maxWordLength: MAX_WORD_LENGTH, ignoreCommands: IGNORE_COMMANDS, allowNumbers: ALLOW_NUMBERS }, recent, rawMessages, rejected });
});


app.get('/api/queue', (req, res) => {
  const after = String(req.query.after || '').trim();
  const latestId = recent.length ? recent[recent.length - 1].id : '';

  // Primeira conexão: não manda fila antiga para não jogar palavras velhas.
  if (!after) {
    return res.json({ ok: true, latestId, items: [] });
  }

  let idx = recent.findIndex(x => x.id === after);
  let items;
  if (idx >= 0) {
    items = recent.slice(idx + 1);
  } else {
    // Se o ID antigo sumiu da memória do Render, manda só as últimas para não travar.
    items = recent.slice(-10);
  }
  res.json({ ok: true, latestId, items });
});

app.post('/api/submit', (req, res) => {
  if (PANEL_PASSWORD && req.body.password !== PANEL_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Senha errada' });
  }
  const payload = addGuess({ nick: req.body.nick, word: req.body.word, color: req.body.color, source: 'site' });
  if (!payload) return res.status(400).json({ ok: false, error: 'Palavra inválida ou bloqueada pelo filtro. Veja /status.html.' });
  res.json({ ok: true, payload });
});

if (TWITCH_CHANNEL) {
  const client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    channels: [TWITCH_CHANNEL]
  });

  client.connect().then(() => {
    status.twitchConnected = true;
    status.twitchConnectionError = null;
    console.log('[TWITCH] conectado no canal:', TWITCH_CHANNEL);
    console.log('[MODO]', ACCEPT_ALL_MESSAGES ? 'sem comando' : 'com prefixo ' + COMMAND_PREFIX);
  }).catch(err => {
    status.twitchConnected = false;
    status.twitchConnectionError = String(err && err.message ? err.message : err);
    console.error('[TWITCH] erro ao conectar:', err);
  });

  client.on('connected', () => {
    status.twitchConnected = true;
    status.twitchConnectionError = null;
  });
  client.on('disconnected', (reason) => {
    status.twitchConnected = false;
    status.twitchConnectionError = String(reason || 'desconectado');
  });

  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    status.totalRaw++;
    status.lastTwitchMessageAt = new Date().toISOString();

    const nick = tags['display-name'] || tags.username || 'viewer';
    const color = tags.color || '#00d5ff';
    const raw = safeText(message, 200);
    pushLimited(rawMessages, { time: status.lastTwitchMessageAt, nick, raw, color }, 40);
    console.log('[CHAT]', `${nick}: ${raw}`);

    let word = '';
    if (ACCEPT_ALL_MESSAGES) {
      if (IGNORE_COMMANDS && /^[!./]/.test(raw)) return reject('comando ignorado', { nick, word: raw, source: 'twitch' });
      word = raw;
    } else if (raw.toLowerCase().startsWith(COMMAND_PREFIX.toLowerCase() + ' ')) {
      word = raw.slice(COMMAND_PREFIX.length).trim();
    } else {
      return reject('não usa prefixo', { nick, word: raw, source: 'twitch' });
    }

    addGuess({ nick, word, color, source: 'twitch' });
  });
} else {
  console.log('[AVISO] TWITCH_CHANNEL vazio. Use /send.html para teste manual.');
}

server.listen(PORT, () => console.log('[OK] servidor online na porta', PORT));
