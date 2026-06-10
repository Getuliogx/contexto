Contexto Chat Render - versão sem comando / sem recarregar

Esta versão corrige o problema de voltar para a tela inicial do Contexto.

O que mudou:
- O Tampermonkey NÃO usa mais requestSubmit().
- O Tampermonkey NÃO clica em botão genérico da página.
- Envia a palavra só pelo campo de texto + tecla Enter.
- Bloqueia submit nativo para evitar recarregar a página.

Troca rápida:
1. No Tampermonkey, apague o script antigo.
2. Cole o arquivo: scripts/contexto-tampermonkey.user.js
3. Troque RENDER_URL pelo link do seu Render, sem barra no final.
4. Salve.
5. Abra o Contexto e dê Ctrl+F5.

Render:
Não precisa recriar se o servidor já está recebendo chat. Só troque o Tampermonkey.

Variáveis recomendadas no Render:
TWITCH_CHANNEL=nomedocanal
ACCEPT_ALL_MESSAGES=true
IGNORE_COMMANDS=true
MAX_WORD_LENGTH=35
ALLOW_NUMBERS=false
PANEL_PASSWORD=1234
