# Handoff

Use este arquivo no fim e no inicio de cada sessao entre PCs.

## Antes de comecar

- PC usado: 
- Data e hora:
- Projeto/pasta:
- Objetivo imediato:
- Arquivos que vao ser tocados:
- Bloqueios conhecidos:

## O que foi feito nesta sessao

- Preparado este PC para continuar o workspace espelhado via OneDrive.
- Git for Windows instalado.
- Node.js LTS portatil baixado para `.local-tools`.
- Dependencias da raiz instaladas com `npm install`.
- Criados `HANDOFF.md`, `.gitignore`, `SETUP_LOCAL.md` e `tools/use-local-dev-tools.ps1`.

## Estado atual

- O que esta funcionando:
- `git --version`
- `node -v` via ambiente local do workspace
- `npm -v` via ambiente local do workspace
- `npm install` na raiz
- `npm test` na raiz
- O que ainda falta:
- Rodar `npm test` neste PC com o ambiente local carregado
- Validar se os subprojetos que tem `package.json` tambem precisam de `npm install`
- Testes rodados:
- `.\tools\npm-local.cmd test`
- Resultado dos testes:
- Aprovado, 2 testes passando fora do sandbox
- No sandbox do Codex, o mesmo comando pode falhar com `spawn EPERM`

## Proximo passo recomendado

- 
- Usar `.\tools\npm-local.cmd <comando>` para comandos npm neste PC
- Se quiser inspecionar versoes, rodar `powershell -ExecutionPolicy Bypass -File .\tools\use-local-dev-tools.ps1`
- Se for trabalhar em subprojeto com `package.json`, instalar dependencias naquele subdiretorio

## Comandos usados

```powershell
# cole aqui os comandos importantes usados nesta sessao
```

## Observacoes para o proximo Codex

- Leia este arquivo antes de alterar qualquer coisa.
- Confirme se o OneDrive terminou de sincronizar.
- Nao trabalhe nos dois PCs ao mesmo tempo.
