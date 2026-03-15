# Setup Local

Este PC ficou com o ambiente abaixo para continuar o trabalho neste workspace:

- Git for Windows instalado em `C:\Program Files\Git`
- Node.js LTS portatil em `C:\Users\caios\OneDrive\Documentos\Codex\.local-tools\node-v24.14.0-win-x64`
- npm disponivel junto com esse Node local

## Depois da instalacao

No terminal, dentro de `C:\Users\caios\OneDrive\Documentos\Codex`:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\use-local-dev-tools.ps1
.\tools\npm-local.cmd install
.\tools\npm-local.cmd test
```

## Nota sobre testes no Codex

`npm test` na raiz passa neste PC, mas no terminal sandboxado do Codex pode falhar com `spawn EPERM`. Quando isso acontecer, peca para o Codex rodar os testes com permissao elevada.

## Fluxo entre os dois PCs

1. Espere o OneDrive terminar a sincronizacao.
2. Abra e atualize o `HANDOFF.md`.
3. So depois rode comandos ou edite arquivos.
4. No fim da sessao, atualize o `HANDOFF.md` com o estado real.

## Observacao

Evite tratar `node_modules` sincronizado pelo OneDrive como fonte de verdade. Se houver diferenca entre maquinas, rode `.\tools\npm-local.cmd install` neste PC.
