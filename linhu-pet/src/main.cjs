'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { DshMonitor } = require('./monitor.cjs');

const WINDOW_WIDTH = 320;
const HEIGHT_OPEN = 450;
const HEIGHT_CLOSED = 330;
const EDGE_MARGIN = 8;

const APP_ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(APP_ROOT, 'assets');

let win = null;
let tray = null;
let monitor = null;
let lastStats = null;
let quitting = false;
let dragging = null;
let saveTimer = null;
let lastDshProbeAt = 0;
let discoveredDshUrl = '';

function resolveDataDir() {
  if (process.env.LINHU_PET_DATA) return process.env.LINHU_PET_DATA;
  const preferred = path.join(app.getPath('appData'), 'LinhuPet');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'LinhuPet');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const dataDir = resolveDataDir();
try { app.setPath('userData', dataDir); } catch {}
const statePath = path.join(dataDir, 'state.json');
const logPath = path.join(dataDir, 'main.log');

function log(...args) {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${args.map(String).join(' ')}\n`);
  } catch {}
}

function readState() {
  const defaults = {
    x: null,
    y: null,
    panelOpen: true,
    alwaysOnTop: true,
    launchAtLogin: false,
    lastDshUrl: '',
    displayId: null,
  };
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

let state = readState();

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      log('saveState failed', error?.message || error);
    }
  }, 180);
}

function iconPath(name) {
  const file = path.join(ASSETS, name);
  return fs.existsSync(file) ? file : null;
}

function getTrayImage() {
  const png = iconPath('tray.png') || iconPath('icon.png');
  if (png) {
    try {
      const image = nativeImage.createFromPath(png);
      if (!image.isEmpty()) return image;
    } catch {}
  }
  const ico = iconPath('tray.ico') || path.join(process.resourcesPath, 'tray.ico');
  try {
    const image = nativeImage.createFromPath(ico);
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  } catch {}
  return nativeImage.createEmpty();
}

function workAreaFor(point) {
  try {
    const display = point ? screen.getDisplayNearestPoint(point) : screen.getPrimaryDisplay();
    return { display, area: display.workArea };
  } catch {
    return { display: null, area: { x: 0, y: 0, width: 1280, height: 800 } };
  }
}

function defaultBounds(anchor = 'top-right') {
  const { display, area } = workAreaFor();
  const height = state.panelOpen ? HEIGHT_OPEN : HEIGHT_CLOSED;
  return {
    x: area.x + area.width - WINDOW_WIDTH - 20,
    y: anchor === 'bottom-right' ? area.y + area.height - height - 20 : area.y + 20,
    displayId: display?.id ?? null,
  };
}

function clampBounds(bounds, height) {
  const { display, area } = workAreaFor({ x: bounds.x + WINDOW_WIDTH / 2, y: bounds.y + height / 2 });
  const minVisible = 80;
  let x = bounds.x;
  let y = bounds.y;
  x = Math.min(Math.max(x, area.x - WINDOW_WIDTH + minVisible), area.x + area.width - minVisible);
  y = Math.min(Math.max(y, area.y - height + minVisible), area.y + area.height - minVisible);
  return { x, y, displayId: display?.id ?? null };
}

function initialBounds() {
  if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
    return clampBounds({ x: state.x, y: state.y }, state.panelOpen ? HEIGHT_OPEN : HEIGHT_CLOSED);
  }
  return defaultBounds();
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function updateTrayTooltip(snapshot) {
  if (!tray) return;
  try {
    const tokens = snapshot?.today?.tokens || 0;
    const label = tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toFixed(1)}M`
      : tokens >= 1000
        ? `${(tokens / 1000).toFixed(1)}K`
        : String(tokens);
    const status = snapshot?.active?.detail || '等待 DSH';
    tray.setToolTip(`林虎 · ${status} · 今日 ${label} tokens`);
  } catch {}
}

function buildMenu() {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  const template = [
    {
      label: visible ? '隐藏林虎' : '显示林虎',
      click: () => { if (visible) win.hide(); else showWindow(); },
    },
    {
      label: '显示信息面板',
      type: 'checkbox',
      checked: Boolean(state.panelOpen),
      click: (item) => setPanelOpen(item.checked),
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: Boolean(state.alwaysOnTop),
      click: (item) => setAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    {
      label: '打开 DeepSeek Harness',
      click: () => openDsh(),
    },
    {
      label: '刷新 token 数据',
      click: () => { monitor?.scan(); },
    },
    { type: 'separator' },
    {
      label: '重置到右上角',
      click: () => resetPosition('top-right'),
    },
    {
      label: '重置到右下角',
      click: () => resetPosition('bottom-right'),
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: Boolean(state.launchAtLogin),
      click: (item) => setLaunchAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: '退出林虎桌宠', click: () => quitApp() },
  ];
  return Menu.buildFromTemplate(template);
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  updateTrayTooltip(lastStats);
}

function createTray() {
  try {
    tray = new Tray(getTrayImage());
    tray.setToolTip('林虎 · DSH 桌宠');
    tray.on('click', () => {
      if (win?.isVisible()) win.hide();
      else showWindow();
      rebuildTrayMenu();
    });
    rebuildTrayMenu();
  } catch (error) {
    log('tray failed', error?.stack || error);
  }
}

function applyAlwaysOnTop(value) {
  state.alwaysOnTop = Boolean(value);
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(state.alwaysOnTop, 'screen-saver', 1);
  }
  saveState();
  rebuildTrayMenu();
}

function setAlwaysOnTop(value) {
  applyAlwaysOnTop(value);
}

function setPanelOpen(open) {
  const next = Boolean(open);
  if (state.panelOpen === next) return;
  state.panelOpen = next;
  const height = next ? HEIGHT_OPEN : HEIGHT_CLOSED;
  if (win && !win.isDestroyed()) {
    const old = win.getBounds();
    const bottom = old.y + old.height;
    let y = bottom - height;
    const clamped = clampBounds({ x: old.x, y }, height);
    win.setBounds({ x: clamped.x, y: clamped.y, width: WINDOW_WIDTH, height }, false);
  }
  saveState();
  rebuildTrayMenu();
  sendToRenderer('pet:panel', next);
}

function setLaunchAtLogin(value) {
  state.launchAtLogin = Boolean(value);
  try {
    app.setLoginItemSettings({
      openAtLogin: state.launchAtLogin,
      path: process.execPath,
      args: [],
    });
  } catch (error) {
    log('setLoginItemSettings failed', error?.message || error);
  }
  saveState();
  rebuildTrayMenu();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  rebuildTrayMenu();
}

function resetPosition(anchor = 'top-right') {
  const bounds = defaultBounds(anchor);
  state.x = bounds.x;
  state.y = bounds.y;
  state.displayId = bounds.displayId;
  if (win && !win.isDestroyed()) {
    win.setBounds({ x: bounds.x, y: bounds.y, width: WINDOW_WIDTH, height: state.panelOpen ? HEIGHT_OPEN : HEIGHT_CLOSED }, false);
  }
  saveState();
}

function quitApp() {
  quitting = true;
  monitor?.stop();
  try { tray?.destroy(); } catch {}
  tray = null;
  if (win && !win.isDestroyed()) win.destroy();
  app.quit();
}

function startDrag() {
  if (!win || win.isDestroyed()) return false;
  if (dragging) return true;
  const cursor = screen.getCursorScreenPoint();
  dragging = {
    startCursor: cursor,
    startBounds: win.getBounds(),
    moved: false,
    timer: null,
    guard: null,
  };
  dragging.timer = setInterval(() => {
    if (!dragging || !win || win.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const dx = point.x - dragging.startCursor.x;
    const dy = point.y - dragging.startCursor.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.moved = true;
    const x = Math.round(dragging.startBounds.x + dx);
    const y = Math.round(dragging.startBounds.y + dy);
    win.setPosition(x, y, false);
  }, 16);
  dragging.guard = setTimeout(() => {
    if (dragging) finishDrag(false);
  }, 45000);
  return true;
}

function finishDrag(moved) {
  if (!dragging) return;
  clearInterval(dragging.timer);
  clearTimeout(dragging.guard);
  const wasMoved = Boolean(moved || dragging.moved);
  const cursor = screen.getCursorScreenPoint();
  dragging = null;
  if (!win || win.isDestroyed()) return;

  const bounds = win.getBounds();
  let x = bounds.x;
  let y = bounds.y;
  const { area, display } = workAreaFor(cursor);
  if (x < area.x + 16) x = area.x + EDGE_MARGIN;
  else if (x + WINDOW_WIDTH > area.x + area.width - 16) x = area.x + area.width - WINDOW_WIDTH - EDGE_MARGIN;
  if (y < area.y + 16) y = area.y + EDGE_MARGIN;
  else if (y + bounds.height > area.y + area.height - 16) y = area.y + area.height - bounds.height - EDGE_MARGIN;
  const clamped = clampBounds({ x, y }, bounds.height);
  win.setPosition(clamped.x, clamped.y, false);
  state.x = clamped.x;
  state.y = clamped.y;
  state.displayId = display?.id ?? clamped.displayId;
  log('drag end', wasMoved, JSON.stringify({ x: clamped.x, y: clamped.y }));
  if (wasMoved) saveState();
  return { moved: wasMoved, x: clamped.x, y: clamped.y };
}

async function probeUrl(url, timeoutMs = 450) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401) return true;
    if (!response.ok) return false;
    const text = await response.text();
    return /__DSH_BOOT__|DeepSeek Harness|dsh/i.test(text);
  } catch {
    return false;
  }
}

async function discoverDshUrl() {
  if (discoveredDshUrl && await probeUrl(discoveredDshUrl, 350)) return discoveredDshUrl;
  const candidates = [];
  if (process.env.DSH_WEB_URL) candidates.push(process.env.DSH_WEB_URL);
  if (state.lastDshUrl) candidates.push(state.lastDshUrl);
  candidates.push('http://127.0.0.1:60483');
  for (let port = 60480; port <= 60500; port++) candidates.push(`http://127.0.0.1:${port}`);
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (await probeUrl(candidate, 350)) {
      discoveredDshUrl = candidate;
      state.lastDshUrl = candidate;
      saveState();
      return candidate;
    }
  }
  return '';
}

async function focusDsh() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class LinhuFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
}
'@
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -eq 'DeepSeek Harness' } | Select-Object -First 1
if (-not $p) { Write-Output 'notrunning'; exit }
$h = $p.MainWindowHandle
[LinhuFocus]::ShowWindow($h, 9) | Out-Null
[LinhuFocus]::BringWindowToTop($h) | Out-Null
[LinhuFocus]::SwitchToThisWindow($h, $true)
$ok = [LinhuFocus]::SetForegroundWindow($h)
if ($ok) { Write-Output 'ok' } else { Write-Output 'focus-failed' }
`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 6000,
    }, (error, stdout) => {
      if (error) return resolve({ ok: false, reason: 'error' });
      const value = String(stdout || '').trim();
      if (value.includes('ok')) return resolve({ ok: true });
      resolve({ ok: false, reason: value || 'notrunning' });
    });
  });
}

async function openDsh() {
  const focused = await focusDsh();
  if (focused.ok) return { ok: true, focused: true };
  const url = await discoverDshUrl();
  if (!url) return { ok: false, error: '没有找到正在运行的 DSH' };
  try {
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: '打开 DSH 失败' };
  }
}

function createWindow() {
  const bounds = initialBounds();
  const height = state.panelOpen ? HEIGHT_OPEN : HEIGHT_CLOSED;
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: WINDOW_WIDTH,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: state.alwaysOnTop,
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    show: false,
    title: '林虎桌宠',
    icon: iconPath('icon.png') || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(state.alwaysOnTop, 'screen-saver', 1);
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  } catch {}

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    if (process.argv.includes('--screenshot-ui')) {
      win.show();
    } else {
      win.showInactive();
    }
    log('window ready', JSON.stringify(win.getBounds()), 'panelOpen', state.panelOpen, 'scale', screen.getPrimaryDisplay().scaleFactor);
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
      const bounds = win.getBounds();
      state.x = bounds.x;
      state.y = bounds.y;
      state.displayId = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })?.id ?? null;
      saveState();
    }
    sendToRenderer('pet:stats', lastStats || monitor?.snapshot || { ok: false, error: '正在读取 DSH 数据…' });
    rebuildTrayMenu();
  });

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    rebuildTrayMenu();
  });

  win.on('moved', () => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    state.x = x;
    state.y = y;
    saveState();
  });

  win.on('closed', () => { win = null; });

  win.webContents.on('render-process-gone', (_event, details) => {
    log('renderer gone', JSON.stringify(details));
    if (!quitting) {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.reload();
      }, 800);
    }
  });
}

function startMonitor() {
  monitor = new DshMonitor({ pollMs: 1400 });
  monitor.on('update', (snapshot) => {
    lastStats = snapshot;
    sendToRenderer('pet:stats', snapshot);
    updateTrayTooltip(snapshot);
  });
  monitor.start();
}

function registerIpc() {
  ipcMain.handle('pet:get-stats', () => lastStats || monitor?.buildSnapshot?.() || monitor?.snapshot || { ok: false });
  ipcMain.handle('pet:get-state', () => ({ panelOpen: state.panelOpen, alwaysOnTop: state.alwaysOnTop }));
  ipcMain.handle('pet:drag-start', () => startDrag());
  ipcMain.handle('pet:drag-end', (_event, payload) => finishDrag(Boolean(payload?.moved)));
  ipcMain.handle('pet:set-panel', (_event, open) => { setPanelOpen(open); return true; });
  ipcMain.handle('pet:open-dsh', () => openDsh());
  ipcMain.handle('pet:refresh', () => { monitor?.scan(); return true; });
  ipcMain.handle('pet:context-menu', () => {
    const menu = buildMenu();
    menu.popup({ window: win || undefined });
    return true;
  });
}

async function runScreenshotMode() {
  const out = process.env.LINHU_OUT || path.join(process.cwd(), 'ui-preview.png');
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const uiState = process.env.LINHU_UI_STATE || '';
  if (uiState === 'drag') {
    await win.webContents.executeJavaScript(`window.__linhuTest?.setDragging(true)`);
  } else if (uiState === 'collapsed') {
    win.setBounds({ x: win.getBounds().x, y: win.getBounds().y + (HEIGHT_OPEN - HEIGHT_CLOSED), width: WINDOW_WIDTH, height: HEIGHT_CLOSED }, false);
    await win.webContents.executeJavaScript(`
      document.body.classList.add('panel-closed');
      document.getElementById('collapseBtn').textContent = '⌃';
    `);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(out, image.toPNG());
    log('screenshot written', out, image.getSize().width, image.getSize().height);
  } catch (error) {
    log('screenshot failed', error?.stack || error);
  }
  quitting = true;
  monitor?.stop();
  try { tray?.destroy(); } catch {}
  tray = null;
  win.destroy();
  app.quit();
}

async function runAssetPreview() {
  const out = process.env.LINHU_OUT || path.join(process.cwd(), 'preview.png');
  const preview = new BrowserWindow({
    width: 640,
    height: 720,
    show: false,
    webPreferences: { offscreen: true, sandbox: false },
  });
  await preview.loadFile(path.join(__dirname, 'preview.html'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await preview.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  log('asset preview written', out, image.getSize().width, image.getSize().height);
  preview.destroy();
  app.quit();
}

async function runIconMode() {
  const out = process.env.LINHU_OUT || path.join(ASSETS, 'icon.png');
  const icon = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: false },
  });
  await icon.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await icon.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  try {
    const trayPath = path.join(ASSETS, 'tray.png');
    fs.writeFileSync(trayPath, image.resize({ width: 32, height: 32 }).toPNG());
  } catch {}
  log('icon written', out, image.getSize().width, image.getSize().height);
  icon.destroy();
  app.quit();
}

async function runScreenCaptureMode() {
  const out = process.env.LINHU_OUT || path.join(process.cwd(), 'desktop.png');
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1600, height: 1000 },
  });
  if (sources.length > 0) {
    fs.writeFileSync(out, sources[0].thumbnail.toPNG());
    log('screen captured', out, sources[0].thumbnail.getSize());
  }
  app.quit();
}

async function runOpenDshTest() {
  const out = process.env.LINHU_OUT || path.join(process.cwd(), 'open-dsh.json');
  const result = await openDsh();
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  log('open dsh test', JSON.stringify(result));
  app.quit();
}

app.setAppUserModelId('com.linhu.dshpet');
// The transparent always-on-top window is stable under software compositing in
// this environment; Chromium's GPU compositor crashed once on first paint.
app.disableHardwareAcceleration();
const utilityMode = ['--preview', '--icon', '--capture-screen', '--test-open'].some((flag) => process.argv.includes(flag));
const gotLock = utilityMode ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    if (process.argv.includes('--preview')) {
      await runAssetPreview();
      return;
    }
    if (process.argv.includes('--icon')) {
      await runIconMode();
      return;
    }
    if (process.argv.includes('--capture-screen')) {
      await runScreenCaptureMode();
      return;
    }
    if (process.argv.includes('--test-open')) {
      await runOpenDshTest();
      return;
    }

    registerIpc();
    startMonitor();
    createWindow();
    createTray();

    try {
      const login = app.getLoginItemSettings();
      state.launchAtLogin = Boolean(login.openAtLogin);
    } catch {}

    if (process.argv.includes('--screenshot-ui')) {
      await runScreenshotMode();
    }
  }).catch((error) => {
    log('whenReady failed', error?.stack || error);
    try { dialog.showErrorBox('林虎桌宠启动失败', String(error?.stack || error)); } catch {}
    app.quit();
  });

  app.on('window-all-closed', () => {
    // Stay alive in the tray even when the pet window is hidden or closed.
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    quitting = true;
    monitor?.stop();
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      state.x = x;
      state.y = y;
      try { fs.writeFileSync(statePath, JSON.stringify(state, null, 2)); } catch {}
    }
  });
}

process.on('uncaughtException', (error) => log('uncaughtException', error?.stack || error));
process.on('unhandledRejection', (error) => log('unhandledRejection', error?.stack || error));
