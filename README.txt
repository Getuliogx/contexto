CONTEXTO CHAT - RENDER - VERSÃO COM STATUS

1) Suba a pasta no GitHub.
2) No Render, crie Web Service.
3) Build Command: npm install
4) Start Command: npm start

Variáveis no Render:
TWITCH_CHANNEL=nomedocanal
ACCEPT_ALL_MESSAGES=true
IGNORE_COMMANDS=true
MAX_WORD_LENGTH=35
ALLOW_NUMBERS=false
PANEL_PASSWORD=1234

IMPORTANTE:
- TWITCH_CHANNEL é sem @.
- Tem que ser nome da Twitch, não link inteiro.
- Depois do deploy, abra:
  https://SEU-PROJETO.onrender.com/status.html

COMO TESTAR:
1) Abra /status.html no Render.
2) Mande uma palavra no chat da Twitch do canal configurado.
3) Veja se aparece em "Últimas mensagens brutas da Twitch".

Se aparecer em "brutas", mas não em "aceitas":
- O filtro rejeitou. Veja o motivo em "Rejeitadas".

Se não aparecer nem em "brutas":
- O Render não está lendo o canal.
- Confira TWITCH_CHANNEL.
- Confira se o serviço está ligado e sem erro nos Logs.
- Se o canal for Kick, esse pacote não lê Kick, só Twitch.

TAMPERMONKEY:
No arquivo scripts/contexto-tampermonkey.user.js, troque:
const RENDER_URL = 'COLE_AQUI_O_LINK_DO_RENDER';
por:
const RENDER_URL = 'https://SEU-PROJETO.onrender.com';

Depois abra https://contexto.me/pt/ com Tampermonkey ligado.
