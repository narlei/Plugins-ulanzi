# PPT Freeze

Plugin para Ulanzi Deck que congela a saida da apresentacao com uma imagem fixa em tela cheia.

## O que ele faz

- tira um screenshot do monitor escolhido
- abre um overlay fullscreen com essa imagem
- permite sair do modo apresentacao sem o publico perceber
- no segundo toque, remove o overlay

## Instalacao

Copie a pasta do plugin para:

`C:\Users\<usuario>\AppData\Roaming\Ulanzi\UlanziDeck\Plugins\com.caios.pptfreeze.ulanziPlugin`

Depois recarregue o Ulanzi Deck.

## Uso

1. Adicione a acao `PPT Freeze > Freeze Toggle`
2. No inspector, deixe `Monitor = Auto` primeiro
3. Entre no modo apresentacao
4. Aperte o botao para congelar
5. Saia do modo apresentacao e faca os ajustes necessarios
6. Aperte novamente para voltar ao vivo

## Estados do botao

- `LIVE`: a saida esta ao vivo
- `FREEZE`: a tela de saida esta travada por uma imagem fixa

## Dica de monitor

- `Auto` tenta usar a tela secundaria primeiro
- se congelar no monitor errado, escolha `Monitor 1`, `Monitor 2` etc
- o inspector mostra um resumo dos monitores detectados

## Deploy seguro

No workspace, publique com:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deploy-ulanzi-plugin.ps1 -PluginName com.caios.pptfreeze.ulanziPlugin
```

Isso evita o problema de pasta aninhada no destino.
