# Ulanzi Deck Plugin Starter

Template inicial para desenvolver plugins do Ulanzi Deck com:

- Runtime de acao (`ActionRuntime`)
- Runtime de status (`StatusRuntime`)
- Cliente WebSocket com reconexao automatica
- Property inspectors para configurar cada botao

## Estrutura

```text
plugin/
  app.js
  actions/
    ActionRuntime.js
    StatusRuntime.js
  services/
    WebSocketClient.js
property-inspectors/
  action/
    inspector.html
    inspector.js
  status/
    inspector.html
    inspector.js
```

## Como usar

1. Copie esta estrutura para a pasta de plugin do Ulanzi Deck.
2. Ajuste o bootstrap em `plugin/app.js` para usar os eventos reais do SDK.
3. Configure os botoes no inspector:
   - Action: `actionId`, `argsJson`, URL WS
   - Status: texto online/offline e URL WS
4. Pressione o botao para disparar o comando via WebSocket.

## Modelo de comando enviado

```json
{
  "type": "run_action",
  "actionId": "scene.switch",
  "args": {
    "scene": "Intro"
  }
}
```

## Integracao com Ulanzi SDK

Este starter inclui um `UDBridge` minimo para funcionar como base. Troque os pontos marcados com `TODO` para conectar aos callbacks reais do SDK.
