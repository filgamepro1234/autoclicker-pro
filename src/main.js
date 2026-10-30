const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { mouse, keyboard, Button, Key, Point } = require('@nut-tree-fork/nut-js');
const { uIOhook, UiohookKey } = require('uiohook-napi');

// nut-js espera 100ms depois de cada ação por defeito — isso limitava o autoclicker a ~10 CPS
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 2000;
keyboard.config.autoDelayMs = 0;

// ─── Teclas: uiohook (gravação) → nut-js (reprodução) ────────────────────────
const UIOHOOK_TO_NUT = {
  Enter: 'Return', NumpadEnter: 'Enter', Backquote: 'Grave',
  BracketLeft: 'LeftBracket', BracketRight: 'RightBracket',
  ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down',
  NumpadMultiply: 'Multiply', NumpadAdd: 'Add', NumpadSubtract: 'Subtract',
  NumpadDecimal: 'Decimal', NumpadDivide: 'Divide',
  NumpadEnd: 'End', NumpadArrowDown: 'Down', NumpadPageDown: 'PageDown', NumpadArrowLeft: 'Left',
  NumpadArrowRight: 'Right', NumpadHome: 'Home', NumpadArrowUp: 'Up', NumpadPageUp: 'PageUp',
  NumpadInsert: 'Insert', NumpadDelete: 'Delete',
  Ctrl: 'LeftControl', CtrlRight: 'RightControl', Alt: 'LeftAlt', AltRight: 'RightAlt',
  Shift: 'LeftShift', ShiftRight: 'RightShift', Meta: 'LeftSuper', MetaRight: 'RightSuper',
  PrintScreen: 'Print',
};
const KEYCODE_TO_NUT = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  let nut = UIOHOOK_TO_NUT[name] || name;
  if (/^[0-9]$/.test(name)) nut = 'Num' + name;
  else if (/^Numpad[0-9]$/.test(name)) nut = 'NumPad' + name.slice(6);
  if (Key[nut] !== undefined) KEYCODE_TO_NUT[code] = nut;
}

const MODIFIER_KEYS = new Set(['LeftControl', 'RightControl', 'LeftAlt', 'RightAlt',
  'LeftShift', 'RightShift', 'LeftSuper', 'RightSuper']);

// Tecla principal de um accelerator do Electron → keycode do uiohook
function acceleratorKeycode(accel) {
  const k = accel.split('+').pop();
  const special = {
    Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
    numadd: 'NumpadAdd', numsub: 'NumpadSubtract', nummult: 'NumpadMultiply',
    numdiv: 'NumpadDivide', numdec: 'NumpadDecimal',
  };
  const name = special[k] || (/^num[0-9]$/.test(k) ? 'Numpad' + k.slice(3) : k);
  return UiohookKey[name];
}

let mainWindow;

// ─── Settings (persistidas em %APPDATA%/autoclicker-macro/settings.json) ─────
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_HOTKEYS = { autoclicker: 'F6', record: 'F7', play: 'F8' };
let settings = {
  ui: null, macroEvents: [], windowBounds: null, hotkeys: { ...DEFAULT_HOTKEYS },
  profiles: {},        // nome → { ui, macroEvents, savedAt }
  activeProfile: null,
};
let saveTimer = null;

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings = { ...settings, ...data, hotkeys: { ...DEFAULT_HOTKEYS, ...data.hotkeys } };
  } catch { /* primeira execução ou ficheiro inválido */ }
}

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettingsNow, 300);
}

function writeSettingsNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('Save settings error:', e.message); }
}

// ─── State ───────────────────────────────────────────────────────────────────
let autoclickerState = {
  running: false,
  intervalId: null,
  config: {
    button: 'left',
    clickType: 'single',
    intervalMode: 'fixed',
    intervalMs: 100,
    intervalMinMs: 50,
    intervalMaxMs: 300,
    repeatMode: 'infinite',
    repeatCount: 10,
    repeatDuration: 5000,
    clickCount: 0,
    targetX: null,
    targetY: null,
    useCurrentPos: true,
  }
};

let macroState = {
  recording: false,
  playing: false,
  events: [],
  lastEventTime: 0,
  keysDown: new Set(),   // keycodes cuja keydown foi gravada
  runId: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getButton(name) {
  if (name === 'right')  return Button.RIGHT;
  if (name === 'middle') return Button.MIDDLE;
  return Button.LEFT;
}

function getInterval(cfg) {
  if (cfg.intervalMode === 'random') {
    const min = Math.min(cfg.intervalMinMs, cfg.intervalMaxMs);
    const max = Math.max(cfg.intervalMinMs, cfg.intervalMaxMs);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return cfg.intervalMs;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function doClick(cfg) {
  try {
    if (!cfg.useCurrentPos && cfg.targetX !== null && cfg.targetY !== null) {
      await mouse.setPosition(new Point(cfg.targetX, cfg.targetY));
    }
    const btn = getButton(cfg.button);
    if (cfg.clickType === 'double') {
      await mouse.doubleClick(btn);
    } else {
      await mouse.click(btn);
    }
    cfg.clickCount++;
    mainWindow?.webContents.send('click-count', cfg.clickCount);
  } catch (e) {
    console.error('Click error:', e.message);
  }
}

// ─── Autoclicker ──────────────────────────────────────────────────────────────
function startAutoclicker(cfg) {
  if (autoclickerState.running) return;
  autoclickerState.running = true;
  autoclickerState.config = { ...autoclickerState.config, ...cfg, clickCount: 0 };
  const startTime = Date.now();

  async function tick() {
    if (!autoclickerState.running) return;
    const c = autoclickerState.config;
    if (c.repeatMode === 'count' && c.clickCount >= c.repeatCount) return stopAutoclicker();
    if (c.repeatMode === 'duration' && Date.now() - startTime >= c.repeatDuration) return stopAutoclicker();
    await doClick(c);
    if (autoclickerState.running) {
      autoclickerState.intervalId = setTimeout(tick, getInterval(autoclickerState.config));
    }
  }

  tick();
  mainWindow?.webContents.send('autoclicker-status', { running: true });
}

function stopAutoclicker() {
  autoclickerState.running = false;
  if (autoclickerState.intervalId) { clearTimeout(autoclickerState.intervalId); autoclickerState.intervalId = null; }
  mainWindow?.webContents.send('autoclicker-status', { running: false });
}

// ─── Macro recording ──────────────────────────────────────────────────────────
function uiohookBtnName(btn) {
  if (btn === 2) return 'right';
  if (btn === 3) return 'middle';
  return 'left';
}

function sendMacroStatus() {
  mainWindow?.webContents.send('macro-status', {
    recording: macroState.recording,
    playing: macroState.playing,
    events: macroState.events,
  });
}

function setMacroEvents(events) {
  macroState.events = Array.isArray(events) ? events : [];
  settings.macroEvents = macroState.events;
  saveSettings();
  sendMacroStatus();
}

// Cliques dentro da janela da app (ex.: o botão "Parar gravação") não entram na macro
function isInsideAppWindow(x, y) {
  if (!mainWindow || mainWindow.isMinimized() || !mainWindow.isVisible()) return false;
  const p = process.platform === 'win32' ? screen.screenToDipPoint({ x, y }) : { x, y };
  const b = mainWindow.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

function recordEvent(ev) {
  const now = Date.now();
  macroState.events.push({ ...ev, delay: Math.max(0, now - macroState.lastEventTime) });
  macroState.lastEventTime = now;
  sendMacroStatus();
}

uIOhook.on('mousedown', (ev) => {
  if (!macroState.recording) return;
  if (isInsideAppWindow(ev.x, ev.y)) return;
  recordEvent({ type: 'click', x: ev.x, y: ev.y, button: uiohookBtnName(ev.button) });
});

function recordKeys() {
  return settings.ui?.toggle?.['macro-rec-keys'] !== false;
}

// A tecla de um hotkey (ex.: F7 para parar) não deve entrar na macro
function isHotkeyPress(ev) {
  return Object.values(settings.hotkeys).some(accel => {
    if (acceleratorKeycode(accel) !== ev.keycode) return false;
    const mods = accel.split('+').slice(0, -1);
    return mods.includes('Ctrl') === ev.ctrlKey && mods.includes('Alt') === ev.altKey
        && mods.includes('Shift') === ev.shiftKey;
  });
}

uIOhook.on('keydown', (ev) => {
  if (!macroState.recording || !recordKeys()) return;
  if (mainWindow?.isFocused()) return;            // escrever nos campos da app não conta
  if (macroState.keysDown.has(ev.keycode)) return; // ignora a auto-repetição de tecla premida
  if (isHotkeyPress(ev)) return;
  const key = KEYCODE_TO_NUT[ev.keycode];
  if (!key) return;
  macroState.keysDown.add(ev.keycode);
  recordEvent({ type: 'keydown', key });
});

uIOhook.on('keyup', (ev) => {
  if (!macroState.recording) return;
  if (!macroState.keysDown.delete(ev.keycode)) return; // só grava keyup se a keydown foi gravada
  recordEvent({ type: 'keyup', key: KEYCODE_TO_NUT[ev.keycode] });
});

function startMacroRecording() {
  if (macroState.recording || macroState.playing) return;
  macroState.recording = true;
  macroState.events = [];
  macroState.keysDown.clear();
  macroState.lastEventTime = Date.now();
  sendMacroStatus();
}

function stopMacroRecording() {
  if (!macroState.recording) return;
  macroState.recording = false;
  // Modificadores premidos para o hotkey de parar (ex.: Ctrl de Ctrl+F7) ficariam presos
  const evs = macroState.events;
  while (evs.length && evs.at(-1).type === 'keydown' && MODIFIER_KEYS.has(evs.at(-1).key)) evs.pop();
  macroState.keysDown.clear();
  setMacroEvents(evs);
}

// ─── Macro playback ───────────────────────────────────────────────────────────
function clampNum(v, min, max, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function normalizePlayOptions(o = {}) {
  return {
    repeatMode:  ['once', 'count', 'infinite'].includes(o.repeatMode) ? o.repeatMode : 'once',
    repeatCount: Math.round(clampNum(o.repeatCount, 1, 1e6, 1)),
    speed:       clampNum(o.speed, 0.1, 10, 1),
    gapMs:       clampNum(o.gapMs, 0, 3600000, 0),
    jitterPx:    o.humanize ? Math.round(clampNum(o.jitterPx, 0, 200, 0)) : 0,
    jitterPct:   o.humanize ? clampNum(o.jitterPct, 0, 100, 0) / 100 : 0,
  };
}

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function playMacro(options) {
  const events = macroState.events;
  if (macroState.playing || macroState.recording || !events.length) return;
  const opts = normalizePlayOptions(options);
  const total = opts.repeatMode === 'infinite' ? 0 : opts.repeatMode === 'count' ? opts.repeatCount : 1;
  const runId = ++macroState.runId;   // um "parar + reproduzir" rápido não deixa a reprodução antiga viva
  const alive = () => macroState.playing && macroState.runId === runId;
  macroState.playing = true;
  sendMacroStatus();
  const held = new Set(); // teclas premidas pela reprodução, para soltar no fim

  // Espera em fatias para que "parar" responda logo, mesmo com delays longos
  const wait = async ms => {
    const end = Date.now() + ms;
    while (alive() && Date.now() < end) await sleep(Math.min(50, end - Date.now()));
  };

  const progress = (rep, index) =>
    mainWindow?.webContents.send('macro-progress', { rep, total, index, count: events.length });

  const runOnce = async rep => {
    for (const [i, ev] of events.entries()) {
      if (!alive()) break;
      const jitter = 1 + (Math.random() * 2 - 1) * opts.jitterPct;
      await wait(Math.max(0, (ev.delay || 0) * jitter / opts.speed));
      if (!alive()) break;
      progress(rep, i + 1);
      try {
        if (ev.type === 'keydown' || ev.type === 'keyup') {
          const k = Key[ev.key];
          if (k === undefined) continue;
          if (ev.type === 'keydown') { await keyboard.pressKey(k); held.add(k); }
          else { await keyboard.releaseKey(k); held.delete(k); }
          continue;
        }
        const j = opts.jitterPx;
        await mouse.setPosition(new Point(ev.x + randInt(-j, j), ev.y + randInt(-j, j)));
        if (ev.type === 'click' || ev.type === 'doubleclick') {
          await sleep(15); // dá tempo à janela alvo de registar o hover
          const btn = getButton(ev.button || 'left');
          if (ev.type === 'click') await mouse.click(btn);
          else await mouse.doubleClick(btn);
        }
      } catch (e) { console.error('Macro error:', e.message); }
    }
  };

  for (let rep = 1; alive() && (total === 0 || rep <= total); rep++) {
    if (rep > 1) await wait(opts.gapMs);
    await runOnce(rep);
    await sleep(0);
  }

  for (const k of held) { try { await keyboard.releaseKey(k); } catch {} }
  if (macroState.runId === runId) {
    macroState.playing = false;
    sendMacroStatus();
  }
}

function stopMacroPlayback() {
  macroState.playing = false;
  sendMacroStatus();
}

// ─── Perfis (configs + macro com nome) ───────────────────────────────────────
const PROFILE_FILE_TAG = 'autoclicker-pro-profile';

function profileList() {
  return { names: Object.keys(settings.profiles).sort((a, b) => a.localeCompare(b)), active: settings.activeProfile };
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 40);
}

// Ficheiros importados podem vir de qualquer lado: só passam eventos com forma conhecida
function sanitizeEvents(events) {
  if (!Array.isArray(events)) return [];
  const num = v => (Number.isFinite(+v) ? Math.round(+v) : 0);
  const out = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const delay = Math.max(0, num(e.delay));
    if (['click', 'doubleclick', 'move'].includes(e.type)) {
      const button = ['left', 'right', 'middle'].includes(e.button) ? e.button : 'left';
      out.push({ type: e.type, x: num(e.x), y: num(e.y), button, delay });
    } else if ((e.type === 'keydown' || e.type === 'keyup') && Key[e.key] !== undefined) {
      out.push({ type: e.type, key: e.key, delay });
    }
  }
  return out;
}

function sanitizeUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = {};
  for (const group of ['seg', 'number', 'toggle', 'select']) {
    out[group] = {};
    for (const [id, v] of Object.entries(ui[group] || {})) {
      if (/^[\w-]{1,40}$/.test(id) && ['string', 'number', 'boolean'].includes(typeof v)) {
        out[group][id] = typeof v === 'string' ? v.slice(0, 40) : v;
      }
    }
  }
  return out;
}

function saveProfile(name, ui) {
  name = cleanName(name);
  if (!name) return { ok: false, error: 'Dá um nome ao perfil' };
  const { tab, ...uiWithoutTab } = ui || {};
  settings.profiles[name] = { ui: uiWithoutTab, macroEvents: macroState.events, savedAt: new Date().toISOString() };
  settings.activeProfile = name;
  saveSettings();
  return { ok: true, ...profileList() };
}

function loadProfile(name) {
  const p = settings.profiles[name];
  if (!p) return { ok: false, error: 'Perfil não encontrado' };
  if (macroState.recording || macroState.playing) return { ok: false, error: 'Pára a gravação/reprodução primeiro' };
  settings.activeProfile = name;
  setMacroEvents(p.macroEvents || []);
  return { ok: true, ui: p.ui, ...profileList() };
}

function deleteProfile(name) {
  delete settings.profiles[name];
  if (settings.activeProfile === name) settings.activeProfile = null;
  saveSettings();
  return { ok: true, ...profileList() };
}

async function exportProfile(name, ui) {
  const p = settings.profiles[name];
  const data = {
    format: PROFILE_FILE_TAG, version: 1,
    name: p ? name : 'Configuração atual',
    ui: p ? p.ui : ui,
    macroEvents: p ? p.macroEvents : macroState.events,
  };
  const safeName = data.name.replace(/[\\/:*?"<>|]/g, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar perfil',
    defaultPath: path.join(app.getPath('documents'), `${safeName}.json`),
    filters: [{ name: 'Perfil AutoClicker', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: 'Não foi possível escrever o ficheiro: ' + e.message }; }
}

async function importProfile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar perfil',
    filters: [{ name: 'Perfil AutoClicker', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };

  let data;
  try { data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); }
  catch { return { ok: false, error: 'O ficheiro não é um JSON válido' }; }

  // Aceita um perfil exportado por esta app ou só uma lista de eventos
  const isProfile = data?.format === PROFILE_FILE_TAG;
  const events = sanitizeEvents(isProfile ? data.macroEvents : data);
  const ui = isProfile ? sanitizeUi(data.ui) : null;
  if (!events.length && !ui) return { ok: false, error: 'O ficheiro não tem um perfil nem eventos de macro' };

  const base = cleanName(isProfile ? data.name : path.basename(filePaths[0], '.json')) || 'Importado';
  let name = base;
  for (let i = 2; settings.profiles[name]; i++) name = `${base} (${i})`;

  settings.profiles[name] = { ui, macroEvents: events, savedAt: new Date().toISOString() };
  saveSettings();
  return { ok: true, name, ...profileList() };
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('start-autoclicker', (_, cfg) => startAutoclicker(cfg));
ipcMain.on('stop-autoclicker',  ()       => stopAutoclicker());
ipcMain.on('start-recording',   ()       => startMacroRecording());
ipcMain.on('stop-recording',    ()       => stopMacroRecording());
ipcMain.on('play-macro',        (_, options) => playMacro(options));
ipcMain.on('stop-macro',        ()       => stopMacroPlayback());
ipcMain.on('set-macro-events',  (_, evs) => { if (!macroState.recording) setMacroEvents(evs); });
ipcMain.handle('get-macro-events', () => macroState.events);
ipcMain.handle('load-settings', () => settings.ui);
ipcMain.on('save-settings', (_, ui) => { settings.ui = ui; saveSettings(); });
ipcMain.handle('get-hotkeys', () => ({
  hotkeys: settings.hotkeys,
  defaults: DEFAULT_HOTKEYS,
  failed: Object.keys(settings.hotkeys).filter(a => !globalShortcut.isRegistered(settings.hotkeys[a])),
}));
ipcMain.handle('set-hotkey', (_, { action, accel }) => ({ ...setHotkey(action, accel), hotkeys: settings.hotkeys }));
// Durante a captura de um atalho na UI, os atuais não podem disparar
ipcMain.on('suspend-hotkeys', () => globalShortcut.unregisterAll());
ipcMain.on('resume-hotkeys',  () => registerHotkeys());
ipcMain.handle('profiles-list',   ()             => profileList());
ipcMain.handle('profile-save',    (_, { name, ui }) => saveProfile(name, ui));
ipcMain.handle('profile-load',    (_, name)      => loadProfile(name));
ipcMain.handle('profile-delete',  (_, name)      => deleteProfile(name));
ipcMain.handle('profile-export',  (_, { name, ui }) => exportProfile(name, ui));
ipcMain.handle('profile-import',  ()             => importProfile());
ipcMain.handle('get-cursor-pos', async () => {
  try { const p = await mouse.getPosition(); return { x: Math.round(p.x), y: Math.round(p.y) }; }
  catch { return { x: 0, y: 0 }; }
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window-close', () => mainWindow?.close());

// ─── App lifecycle ────────────────────────────────────────────────────────────
function createWindow() {
  const b = settings.windowBounds;
  // Só reaproveita a posição se ainda couber num ecrã ligado
  const onScreen = b && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100;
  });

  mainWindow = new BrowserWindow({
    width: b?.width || 860, height: b?.height || 680,
    ...(onScreen ? { x: b.x, y: b.y } : {}),
    minWidth: 780, minHeight: 600,
    frame: false, backgroundColor: '#0d0d0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) settings.windowBounds = mainWindow.getBounds();
    writeSettingsNow();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const HOTKEY_ACTIONS = {
  autoclicker: () => mainWindow?.webContents.send('hotkey-toggle-autoclicker'),
  record: () => { if (macroState.recording) stopMacroRecording(); else startMacroRecording(); },
  play: () => { if (macroState.playing) stopMacroPlayback(); else mainWindow?.webContents.send('hotkey-play-macro'); },
};

// Devolve as ações cujo atalho não pôde ser registado (ex.: já usado por outra app)
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, accel] of Object.entries(settings.hotkeys)) {
    let ok = false;
    try { ok = globalShortcut.register(accel, HOTKEY_ACTIONS[action]); } catch {}
    if (!ok) failed.push(action);
  }
  return failed;
}

function setHotkey(action, accel) {
  if (!HOTKEY_ACTIONS[action]) return { ok: false, error: 'Ação inválida' };
  const taken = Object.entries(settings.hotkeys).find(([a, k]) => a !== action && k === accel);
  if (taken) return { ok: false, error: `${accel} já está atribuído a outra ação` };
  const previous = settings.hotkeys[action];
  settings.hotkeys[action] = accel;
  if (registerHotkeys().includes(action)) {
    settings.hotkeys[action] = previous;
    registerHotkeys();
    return { ok: false, error: `${accel} está a ser usado por outra aplicação` };
  }
  saveSettings();
  return { ok: true };
}

app.whenReady().then(() => {
  loadSettings();
  macroState.events = Array.isArray(settings.macroEvents) ? settings.macroEvents : [];
  createWindow();
  registerHotkeys();
  try { uIOhook.start(); } catch (e) { console.error('uIOhook start error:', e.message); }
});

app.on('window-all-closed', () => {
  stopAutoclicker();
  stopMacroPlayback();
  globalShortcut.unregisterAll();
  try { uIOhook.stop(); } catch {}
  app.quit();
});
