# AutoClicker Pro

AutoClicker e Macro Recorder para Windows, construído com Electron + Node.js.

## ⚠️ Requisito importante — Node.js

Este projeto usa `uiohook-napi` para captura global de eventos de rato.

**Node.js compatível: v18, v20 ou v22 (LTS)**  
❌ **Node 24 NÃO é suportado** — os módulos nativos ainda não têm prebuild para ele.

### Verificar a tua versão

```
node -v
```

Se for v24.x, faz o downgrade para Node 22 LTS em:  
👉 https://nodejs.org/en/download  
(escolhe "22.x LTS")

---

## Funcionalidades

- **Autoclicker** — botão esquerdo, direito ou médio; clique simples ou duplo
- **Intervalo fixo ou aleatório** (modo humano)
- **Macro Recorder real** — captura cliques e teclado globais via `uiohook-napi`
- **Adição manual de eventos** na macro
- **Reprodução configurável** — 1 vez / N vezes / infinito, velocidade de 0.25× a 8×, pausa entre repetições e modo "humanizar" (desvio aleatório de posição e tempos), com progresso em tempo real
- **Agendamento** — parar após N cliques, duração, ou infinito
- **Hotkeys globais configuráveis** — por defeito F6, F7, F8 (separador Definições)
- **Delay de arranque** com countdown visual
- **Contador de cliques + CPS** em tempo real
- **Perfis** — guarda autoclicker + agendamento + macro com um nome (ex.: um por jogo), e exporta/importa como `.json` (separador Definições)
- **Configurações guardadas** — intervalos, botões, agendamento, macro gravada e posição da janela ficam em `%APPDATA%\autoclicker-macro\settings.json` e são restaurados ao abrir

---

## Descarregar

O instalador mais recente está em **Releases** (`AutoClicker Pro Setup x.y.z.exe`). Corre-o e escolhe a pasta de instalação.

---

## Instalação (a partir do código)

```bash
# 1. Garante que tens Node 22 LTS
node -v   # deve mostrar v22.x.x

# 2. Entra na pasta do projeto
cd autoclicker

# 3. Instala dependências
npm install

# 4. Inicia
npm start
```

---

## Compilar instalador (.exe)

```bash
npm run build
```

O instalador fica em `dist/AutoClicker Pro Setup <versão>.exe`. O ícone é gerado por `npm run icon` (`build-tools/make-icon.js`).

---

## Estrutura

```
autoclicker/
├── src/
│   ├── main.js       ← Lógica principal (autoclicker + macro + hotkeys)
│   ├── preload.js    ← Bridge IPC segura
│   └── index.html    ← Interface completa
├── package.json
└── README.md
```

---

## Hotkeys

Atalhos por defeito (podem ser mudados no separador **Definições**):

| Tecla | Ação |
|-------|------|
| F6 | Iniciar / Parar autoclicker |
| F7 | Iniciar / Parar gravação de macro |
| F8 | Reproduzir / Parar macro |

---

## Erros comuns

### `prebuild not found` ou `node-v1xx` no erro
→ Estás a usar Node 24. Instala Node 22 LTS e volta a tentar.

### `EPERM` ou `rmdir` no cleanup
→ Fecha qualquer janela do explorador de ficheiros que esteja dentro de `node_modules` e volta a correr `npm install`.

### Rato não se move durante playback
→ Corre a app como Administrador (botão direito → "Executar como administrador").

### `Cannot create symbolic link` ao compilar (winCodeSign)
→ O electron-builder precisa de privilégios para extrair ficheiros de macOS que não são usados. Extrai o pacote à mão sem essa pasta:

```bat
cd /d "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
"<pasta do projeto>\node_modules\7zip-bin\win\x64\7za.exe" x <ficheiro>.7z -owinCodeSign-2.6.0 -xr!darwin
```

Ou corre `npm run build` num terminal como Administrador / com o Modo de Programador do Windows ativo.
