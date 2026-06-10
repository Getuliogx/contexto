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

// MODO SEM COMANDO: por padrão qualquer mensagem curta de 1 palavra vira tentativa.
const ACCEPT_ALL_MESSAGES = String(process.env.ACCEPT_ALL_MESSAGES || 'true').toLowerCase() === 'true';
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!c';

// Filtros para não jogar qualquer coisa errada no Contexto.
const MAX_WORD_LENGTH = Number(process.env.MAX_WORD_LENGTH || 35);
const IGNORE_COMMANDS = String(process.env.IGNORE_COMMANDS || 'true').toLowerCase() === 'true';
const ALLOW_NUMBERS = String(process.env.ALLOW_NUMBERS || 'false').toLowerCase() === 'true';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const recent = [];

function safeText(v, max = 80) {
  return String(v || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripEdges(v) {
  // Remove pontuação só das pontas, mantendo acentos/letras no meio.
  return String(v || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function normalizeWord(v) {
  return stripEdges(safeText(v, MAX_WORD_LENGTH + 10)).toLowerCase();
}

function isValidContextoWord(word) {
  if (!word) return false;
  if (word.length > MAX_WORD_LENGTH) return false;
  if (/\s/.test(word)) return false; // não aceita frase
  if (/https?:\/\//i.test(word) || /^www\./i.test(word)) return false;
  if (word.startsWith('@') || word.startsWith('#')) return false;
  if (!ALLOW_NUMBERS && /\p{N}/u.test(word)) return false;

  // Aceita palavras com letras, acentos e hífen/apóstrofo simples no meio.
  return /^[\p{L}]+(?:[-'’][\p{L}]+)*$/u.test(word);
}

function sendAll(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function addGuess({ nick, word, color, source }) {
  nick = safeText(nick, 32) || 'viewer';
  word = normalizeWord(word);
  color = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#00d5ff';
  source = safeText(source, 20) || 'manual';

  if (!isValidContextoWord(word)) return null;

  const payload = {
    type: 'guess',
    id: Date.now() + '-' + Math.random().toString(16).slice(2),
    nick,
    word,
    color,
    source,
    time: new Date().toISOString()
  };

  recent.push(payload);
  while (recent.length > 50) recent.shift();
  sendAll(payload);
  return payload;
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', recent }));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    channel: TWITCH_CHANNEL || null,
    mode: ACCEPT_ALL_MESSAGES ? 'sem_comando' : 'com_prefixo',
    prefix: COMMAND_PREFIX,
    maxWordLength: MAX_WORD_LENGTH,
    ignoreCommands: IGNORE_COMMANDS
  });
});

app.post('/api/submit', (req, res) => {
  if (PANEL_PASSWORD && req.body.password !== PANEL_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Senha errada' });
  }
  const payload = addGuess({
    nick: req.body.nick,
    word: req.body.word,
    color: req.body.color,
    source: 'site'
  });
  if (!payload) return res.status(400).json({ ok: false, error: 'Palavra inválida. Use só 1 palavra curta.' });
  res.json({ ok: true, payload });
});

if (TWITCH_CHANNEL) {
  const client = new tmi.Client({
    connection: { reconnect: true, secure: true },
    channels: [TWITCH_CHANNEL]
  });

  client.connect().then(() => {
    console.log('Lendo chat da Twitch:', TWITCH_CHANNEL);
    console.log('Modo:', ACCEPT_ALL_MESSAGES ? 'sem comando' : 'com prefixo ' + COMMAND_PREFIX);
  }).catch(err => {
    console.error('Erro ao conectar no chat da Twitch:', err);
  });

  client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const nick = tags['display-name'] || tags.username || 'viewer';
    const color = tags.color || '#00d5ff';
    const raw = safeText(message, 200);
    let word = '';

    if (ACCEPT_ALL_MESSAGES) {
      // Ignora comandos normais do chat como !uptime, !pix, !lurk etc.
      if (IGNORE_COMMANDS && /^[!./]/.test(raw)) return;
      word = raw;
    } else if (raw.toLowerCase().startsWith(COMMAND_PREFIX.toLowerCase() + ' ')) {
      word = raw.slice(COMMAND_PREFIX.length).trim();
    }

    word = normalizeWord(word);
    if (!isValidContextoWord(word)) return;

    addGuess({ nick, word, color, source: 'twitch' });
  });
} else {
  console.log('TWITCH_CHANNEL vazio. Usando só envio manual pelo /send.html.');
}

server.listen(PORT, () => console.log('Servidor online na porta', PORT));
