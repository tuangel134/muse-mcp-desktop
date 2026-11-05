'use strict';
// Muse MCP Desktop · proceso principal.
// Ventana única: Muse (web) a la izquierda y el gestor de Master MCP en un panel lateral a la derecha.
// El Master MCP corre como proceso hijo (el mismo Electron en modo Node) y solo escucha en 127.0.0.1.
const { app, BaseWindow, WebContentsView, ipcMain, dialog, clipboard, shell, session, Menu, screen } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// La app se muestra como «Muse»; los datos siguen en una carpeta propia para no mezclarlos con otras apps.
app.setPath('userData', path.join(app.getPath('appData'), 'muse-mcp-desktop'));
app.setName('Muse');
if (process.platform === 'linux') app.setDesktopName('muse-mcp-desktop.desktop');

const MUSE_URL = process.env.MUSE_URL || 'https://muse.ai/';
const PARTITION = 'persist:muse';
const PANEL_OPEN_W = 480;
const PANEL_CLOSED_W = 36;
const POPUP_HOSTS = /(^|\.)(muse\.ai|meta\.com|facebook\.com|instagram\.com|google\.com|apple\.com|microsoft\.com|live\.com)$/i;

let win = null;
let museView = null;
let panelView = null;
let panelOpen = true;
let host = null;          // { child, port }
let hostStopping = false;
let hostRestarts = 0;
let token = '';
let quitting = false;

const userData = () => app.getPath('userData');
const settingsFile = () => path.join(userData(), 'app-settings.json');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  try {
    fs.mkdirSync(userData(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }), { mode: 0o600 });
  } catch { /* no crítico */ }
}

function loadToken() {
  const file = path.join(userData(), 'control-token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 40) return t;
  } catch { /* se genera uno nuevo */ }
  fs.mkdirSync(userData(), { recursive: true });
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

// ---------------------------------------------------------------- proceso del Master MCP
async function startHost() {
  const hostPath = path.join(app.getAppPath(), 'host', 'host.cjs');
  if (!fs.existsSync(hostPath)) throw new Error('Falta host/host.cjs: ejecuta "npm run build:host".');
  const port = host && host.port ? host.port : Number(process.env.MUSE_MCP_PORT) || await freePort();
  const dataDir = path.join(userData(), 'mastermcp');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(userData(), 'host.log'), 'a', 0o600);
  const child = spawn(process.execPath, [hostPath], {
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MUSE_MCP_PORT: String(port),
      MUSE_MCP_TOKEN: token,
      MUSE_MCP_DATA: dataDir,
      MUSE_MCP_APP_DIR: app.getAppPath(),
      MUSE_MCP_PARENT_PID: String(process.pid),
      MUSE_MCP_PROTECTED: userData()
    }
  });
  fs.closeSync(log);
  host = { child, port };
  child.on('exit', (code) => {
    if (hostStopping || quitting) return;
    // Reinicio con espera creciente; tras varios fallos seguidos se deja de insistir.
    hostRestarts += 1;
    if (hostRestarts <= 5) setTimeout(() => { startHost().catch(() => {}); }, Math.min(1000 * hostRestarts, 5000));
    else dialog.showErrorBox('Master MCP', `El Master MCP se detuvo (código ${code}). Mira host.log en ${userData()}.`);
  });
  await waitHost(port);
  hostRestarts = 0;
}

async function waitHost(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'X-Hub-Token': token } });
      if (r.ok) return;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El Master MCP no respondió a tiempo.');
}

function stopHost() {
  hostStopping = true;
  if (host && host.child && !host.child.killed) { try { host.child.kill(); } catch { /* ya terminó */ } }
}

async function hostRequest(reqPath, payload) {
  if (!host) throw new Error('El Master MCP no está en marcha.');
  if (!/^\/[a-z0-9/_-]*$/i.test(reqPath)) throw new Error('Ruta no válida.');
  const r = await fetch(`http://127.0.0.1:${host.port}${reqPath}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'X-Hub-Token': token, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ---------------------------------------------------------------- ventana
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const pw = Math.min(panelOpen ? PANEL_OPEN_W : PANEL_CLOSED_W, width);
  museView.setBounds({ x: 0, y: 0, width: Math.max(width - pw, 0), height });
  panelView.setBounds({ x: Math.max(width - pw, 0), y: 0, width: pw, height });
}

function setPanel(open) {
  panelOpen = open;
  writeSettings({ panelOpen: open });
  layout();
  if (panelView) panelView.webContents.send('panel:state', open);
}

function isPanelSender(event) {
  return Boolean(panelView) && event.sender === panelView.webContents;
}

function secureMuseSession() {
  const ses = session.fromPartition(PARTITION);
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function createWindow() {
  // MUSE_MCP_DISPLAY=<texto> abre la ventana en la pantalla cuyo nombre lo contenga (útil con varios monitores).
  const want = (process.env.MUSE_MCP_DISPLAY || '').toLowerCase();
  const target = want ? screen.getAllDisplays().find((d) => (d.label || '').toLowerCase().includes(want)) : null;
  const saved = readSettings().bounds;
  const size = { width: 1360, height: 880 };
  let pos = {};
  if (target) pos = { x: target.bounds.x + Math.max(0, Math.round((target.bounds.width - size.width) / 2)), y: target.bounds.y + Math.max(0, Math.round((target.bounds.height - size.height) / 2)) };
  else if (saved && typeof saved.x === 'number' && screen.getAllDisplays().some((d) => saved.x >= d.bounds.x && saved.x < d.bounds.x + d.bounds.width)) pos = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const iconFile = [process.env.MUSE_MCP_ICON, path.join(app.getAppPath(), 'build', 'icon.png')].find((f) => f && fs.existsSync(f));
  win = new BaseWindow({ ...size, ...pos, minWidth: 760, minHeight: 520, title: 'Muse', autoHideMenuBar: true, ...(iconFile ? { icon: iconFile } : {}) });
  win.setMenuBarVisibility(false);   // sin barra de menús; los atajos (Ctrl+Mayús+M, zoom, recargar) siguen activos

  museView = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  panelView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  win.contentView.addChildView(museView);
  win.contentView.addChildView(panelView);

  // Muse: solo http(s); las ventanas emergentes de inicio de sesión se permiten en dominios conocidos, el resto va al navegador del sistema.
  museView.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && POPUP_HOSTS.test(u.hostname)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } } };
      }
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
    } catch { /* URL inválida */ }
    return { action: 'deny' };
  });
  museView.webContents.on('will-navigate', (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
  panelView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panelView.webContents.on('will-navigate', (e) => e.preventDefault());

  panelView.webContents.on('did-finish-load', () => panelView.webContents.send('panel:state', panelOpen));
  museView.webContents.loadURL(MUSE_URL);
  panelView.webContents.loadFile(path.join(__dirname, '..', 'panel', 'index.html'));

  win.on('resize', layout);
  win.on('close', () => { if (win && !win.isMinimized() && !win.isMaximized()) writeSettings({ bounds: win.getBounds() }); });
  win.on('closed', () => { win = null; museView = null; panelView = null; });
  layout();
}

function buildMenu() {
  const template = [
    { label: 'Archivo', submenu: [{ label: 'Salir', role: 'quit', accelerator: 'CommandOrControl+Q' }] },
    { label: 'Ver', submenu: [
      { label: 'Mostrar/ocultar panel Master MCP', accelerator: 'CommandOrControl+Shift+M', click: () => setPanel(!panelOpen) },
      { label: 'Recargar Muse', accelerator: 'CommandOrControl+R', click: () => museView && museView.webContents.reload() },
      { label: 'Zoom +', accelerator: 'CommandOrControl+=', click: () => museView && museView.webContents.setZoomLevel(museView.webContents.getZoomLevel() + 0.5) },
      { label: 'Zoom −', accelerator: 'CommandOrControl+-', click: () => museView && museView.webContents.setZoomLevel(museView.webContents.getZoomLevel() - 0.5) },
      { label: 'Zoom 100 %', accelerator: 'CommandOrControl+0', click: () => museView && museView.webContents.setZoomLevel(0) }
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Abrir carpeta de datos', click: () => shell.openPath(userData()) },
      { label: 'Ver registro del Master MCP', click: () => shell.openPath(path.join(userData(), 'host.log')) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- IPC (solo desde el panel)
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isPanelSender(event)) return { error: 'Remitente no autorizado.' };
    try { return { data: await fn(...args) }; } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
}

function registerIpc() {
  handle('mcp:request', (p, payload) => hostRequest(String(p), payload));
  handle('app:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Carpeta de trabajo para Muse' });
    return r.canceled ? '' : r.filePaths[0];
  });
  handle('app:copy', (text) => { clipboard.writeText(String(text).slice(0, 100000)); return true; });
  handle('app:info', () => ({ version: app.getVersion(), dataDir: userData() }));
  handle('app:setup-prompt', (url) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL no válida.');
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'setup-prompt.md'), 'utf8');
    return tpl.replaceAll('{{URL}}', u.href).replaceAll('{{BASE}}', u.origin);
  });
  handle('panel:toggle', () => { setPanel(!panelOpen); return panelOpen; });
  handle('muse:insert', async (text) => {
    if (!museView) return false;
    const code = `(() => {
      const text = ${JSON.stringify(String(text))};
      const el = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      if (!el) return false;
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        set.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll');
        document.execCommand('insertText', false, text);
      }
      return true;
    })()`;
    return museView.webContents.executeJavaScript(code, true);
  });
}

// ---------------------------------------------------------------- ciclo de vida
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    token = loadToken();
    const saved = readSettings();
    panelOpen = saved.panelOpen !== false;   // la primera vez se abre para guiar la configuración
    secureMuseSession();
    registerIpc();
    buildMenu();
    createWindow();
    try { await startHost(); } catch (e) { dialog.showErrorBox('Master MCP', String(e.message || e)); }
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('before-quit', () => { quitting = true; stopHost(); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());
  app.on('window-all-closed', () => { app.quit(); });
}
