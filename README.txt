COMO USAR - Contexto + nick colorido no quadrinho - MODO SEM COMANDO

O QUE ESSE PACOTE FAZ
- Roda no Render, não no seu PC.
- Lê o chat público da Twitch de um canal configurado.
- No modo padrão, qualquer mensagem curta de 1 palavra vira tentativa no Contexto.
- Pega nick, palavra e cor do nick.
- Manda para o navegador do Contexto via WebSocket.
- O script Tampermonkey envia a palavra no Contexto e tenta colocar o nick colorido no mesmo quadrinho da palavra.

IMPORTANTE
- Não precisa usar !c.
- Se alguém mandar uma frase, link, número, @nick, emoji ou comando tipo !pix, o sistema ignora.
- Para canal de outra pessoa na Twitch, coloque o nome do canal em TWITCH_CHANNEL. Não precisa ser dono do canal para ler chat público.
- O Contexto pode mudar o HTML a qualquer momento. Se o site mudar muito, talvez precise ajustar o Tampermonkey.

1) SUBIR NO RENDER
- Crie um repositório no GitHub com estes arquivos.
- No Render: New > Web Service.
- Conecte o repositório.
- Environment: Node
- Build Command: npm install
- Start Command: npm start

2) VARIÁVEIS NO RENDER
Use assim para NÃO precisar de comando:

TWITCH_CHANNEL=nomedocanal
ACCEPT_ALL_MESSAGES=true
IGNORE_COMMANDS=true
MAX_WORD_LENGTH=35
ALLOW_NUMBERS=false
PANEL_PASSWORD=1234

Com isso, se alguém mandar no chat:

casa
amor
escola

O sistema envia essas palavras para o Contexto.

Se alguém mandar:

!pix
boa noite galera
https://site.com
@fulano
123

O sistema ignora.

3) TESTAR SEM TWITCH
Abra:
https://SEU-RENDER.onrender.com/send.html

Digite senha, nick, cor e palavra.

4) INSTALAR NO TAMPERMONKEY
- Instale a extensão Tampermonkey no navegador.
- Crie um novo script.
- Cole o conteúdo de scripts/contexto-tampermonkey.user.js.
- Troque esta linha:
const RENDER_URL = 'COLE_AQUI_O_LINK_DO_RENDER';

Por exemplo:
const RENDER_URL = 'https://contexto-chat-render.onrender.com';

5) USAR
- Abra https://contexto.me/pt/ no navegador com Tampermonkey ligado.
- Deixe essa aba aberta.
- Peça para o chat mandar só palavras.
- A palavra deve ser enviada ao Contexto e o nick colorido deve aparecer na linha/quadrinho da palavra.

6) OBS
No OBS, capture a janela/aba do navegador do Contexto. Não precisa overlay separado.
