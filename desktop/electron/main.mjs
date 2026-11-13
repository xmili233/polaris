import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, powerSaveBlocker, nativeTheme, nativeImage, screen, shell, systemPreferences, utilityProcess } from 'electron';
import { translator, resolveLanguage, matchLanguage, isLanguagePreference, errorMessage } from '../dist-i18n/index.mjs';
import { isAppearance, readAppearancePreference, readLanguagePreference, writeAppearancePreference, writeLanguagePreference } from './preferences.mjs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { activeDatabase } from '../dist-service/workspaces.js';
import { LocalHost, validateCall, externalURL } from './host.mjs';
import { symbols } from './platform.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv;
const testing = process.env.POLARIS_TEST === '1';
const argument = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : args.find(value => value.startsWith(name + '='))?.slice(name.length + 1); };
const defaultDatabase = path.join(homedir(), 'Library/Application Support/Polaris Desktop/Workspace/polaris.sqlite');
const legacyDatabase = path.resolve(argument('--database') ?? defaultDatabase);
let database = legacyDatabase, workspaceError;
try { if (!argument('--database')) database = activeDatabase(defaultDatabase); } catch (error) { workspaceError = error; }
const isolatedTest = testing && argument('--database') && legacyDatabase !== defaultDatabase;
const profile = isolatedTest
  ? path.resolve(argument('--user-data-dir') ?? path.join(path.dirname(legacyDatabase), 'test-profile'))
  : path.join(path.dirname(defaultDatabase), 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
// A second app instance must not recover and run the same persisted jobs.
if (!testing && !app.requestSingleInstanceLock()) app.exit(0);
if (!testing) app.on('second-instance', () => { if (app.isReady()) { if (!window) createWindow(); else window.show(); } });
const showTestWindow = testing && process.env.POLARIS_TEST_VISIBLE === '1';
if (testing && process.platform === 'darwin') app.setActivationPolicy('accessory');
let host;
let quittingWorkspace = false;
let workspaceTimer;
let workspaceBackoff = 2000;
let maintainingWorkspace = false;
const serviceDirectory = app.isPackaged ? path.join(process.resourcesPath, 'service') : path.join(root, 'dist-service');
// Background Agent turns stop when macOS suspends the app; keep it awake only while one is executing (R-D122).
let awake = null;
function keepAwake(on) {
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
  else if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
}
function localHost() {
  if (workspaceError) throw workspaceError;
  if (quittingWorkspace) throw Object.assign(new Error('Workspace is changing.'), { code: 'connection' });
  const workspace = database;
  return host ??= new LocalHost('', workspace, () => utilityProcess.fork(path.join(serviceDirectory, 'host.js'), ['--database', workspace],
    { stdio: 'pipe', execArgv: ['--no-warnings'], serviceName: 'Polaris local service', env: { ...process.env, POLARIS_NODE_EXECUTABLE: process.execPath, POLARIS_LANGUAGE: language } }), {
    onEvent: event => {
      if (event === 'agentRunning' || event === 'agentIdle') { keepAwake(event === 'agentRunning' && workspace === database); return; }
      if (event === 'agentChanged' && workspace === database) window?.webContents.send('polaris:agent-changed');
    },
  });
}
async function maintainWorkspace() {
  clearTimeout(workspaceTimer);
  if (quittingWorkspace || maintainingWorkspace) return;
  maintainingWorkspace = true;
  try {
    if (!quittingWorkspace) await localHost().call('workspaceStart');
    workspaceBackoff = 2000;
    if (!quittingWorkspace) { workspaceTimer = setTimeout(maintainWorkspace, 30_000); workspaceTimer.unref(); }
  } catch {
    if (!quittingWorkspace) { workspaceTimer = setTimeout(maintainWorkspace, workspaceBackoff); workspaceTimer.unref(); }
    workspaceBackoff = Math.min(workspaceBackoff * 2, 60_000);
  } finally { maintainingWorkspace = false; }
}
const symbolCache = new Map();
const languageArgument = argument('--language') ?? argument('-AppleLanguages');
let language = 'en';
let languagePreference = 'auto';
let languageWrite = Promise.resolve();
let appearance = 'system';
let appearanceWrite = Promise.resolve();
// Dark matches the page token in desktop/src/theme.css, so a dark window never flashes white before the UI paints.
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#0F1012' : '#FFFFFF';
const preferencesFile = path.join(app.getPath('userData'), 'preferences.json');
let window;
let settingsOnLaunch = false;
const entry = pathToFileURL(path.join(root, 'dist/index.html')).href;
const devURL = !app.isPackaged ? process.env.POLARIS_DEV_URL : undefined;

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url.split('#')[0] !== (devURL ?? entry).split('#')[0]) throw new Error('Untrusted desktop frame.');
}

function desktopConfig() {
  // Tests may pin reduced motion so results do not depend on the machine's accessibility setting.
  const pinnedMotion = testing ? process.env.POLARIS_TEST_REDUCED_MOTION : undefined;
  const reducedMotion = pinnedMotion === '1' || pinnedMotion === '0' ? pinnedMotion === '1' : systemPreferences.getAnimationSettings().prefersReducedMotion;
  const config = { language, languagePreference, appearance, dark: nativeTheme.shouldUseDarkColors, reducedMotion, showSettings: settingsOnLaunch,
    launch: !app.isPackaged || process.env.POLARIS_TEST === '1' ? {
      goal: argument('-PolarisGoal'), select: argument('-PolarisSelect'), choose: argument('-PolarisChoose'),
      decide: argument('-PolarisDecide'),
      dumpLayout: argument('-PolarisDumpLayout'),
    } : {} };
  return config;
}
ipcMain.handle('polaris:config', event => { trusted(event); const config = desktopConfig(); settingsOnLaunch = false; return config; });
ipcMain.handle('polaris:set-language', (event, preference) => {
  trusted(event);
  if (!isLanguagePreference(preference)) throw new Error('Invalid language preference.');
  const change = async () => {
    await writeLanguagePreference(preferencesFile, preference);
    languagePreference = preference;
    language = resolveLanguage(preference, app.getPreferredSystemLanguages());
    updateMenu();
    void host?.call('agentLocale', { language }).catch(() => {});
    const config = desktopConfig();
    window?.webContents.send('polaris:config-changed', config);
    return config;
  };
  const pending = languageWrite.then(change);
  languageWrite = pending.catch(() => {});
  return pending;
});
ipcMain.handle('polaris:set-appearance', (event, preference) => {
  trusted(event);
  if (!isAppearance(preference)) throw new Error('Invalid appearance preference.');
  const change = async () => {
    await writeAppearancePreference(preferencesFile, preference);
    appearance = preference;
    nativeTheme.themeSource = preference;
    const config = desktopConfig();
    window?.webContents.send('polaris:config-changed', config);
    return config;
  };
  const pending = appearanceWrite.then(change);
  appearanceWrite = pending.catch(() => {});
  return pending;
});
ipcMain.handle('polaris:pick-attachments', async event => {
  trusted(event);
  try {
    const selectedDatabase = database;
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    if (selected.canceled) return { result: [] };
    if (selectedDatabase !== database) throw Object.assign(new Error('Workspace changed.'), { code: 'conflict' });
    return { result: await localHost().call('agentAttachmentImport', { paths: selected.filePaths }) };
  } catch (error) { return { error: { code: error.code ?? 'attachment_file', message: errorMessage(error, language), ...(error.messageKey ? { messageKey: error.messageKey, params: error.params } : {}) } }; }
});
ipcMain.handle('polaris:call', async (event, method, params) => {
  trusted(event); validateCall(method, params);
  try {
    if (method === 'symbols') {
      const result = symbols(params.symbols, nativeImage, symbolCache);
      return { result };
    }
    if (method === 'knowledgeImport' || method === 'knowledgeExport') {
      const selectedDatabase = database, selectedHost = localHost();
      const checkWorkspace = () => {
        if (quittingWorkspace || selectedDatabase !== database || selectedHost !== host)
          throw Object.assign(new Error('Workspace changed. Reopen the document and try again.'), { code: 'conflict', messageKey: 'knowledge.workspaceChanged' });
      };
      if (method === 'knowledgeImport') {
        const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (selected.canceled || !selected.filePaths.length) return { result: null };
        checkWorkspace();
        const file = selected.filePaths[0];
        let markdown;
        try {
          if ((await stat(file)).size > 1_048_576) throw new Error('File too large.');
          const bytes = await readFile(file);
          if (bytes.byteLength > 1_048_576) throw new Error('File too large.');
          markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch { throw Object.assign(new Error('Cannot read this Markdown file.'), { code: 'invalid_input', messageKey: 'knowledge.fileError' }); }
        checkWorkspace();
        return { result: await selectedHost.call('knowledgeImportText', { markdown, filename: path.basename(file), requestID: params.requestID, goalID: params.goalID }) };
      }
      const exported = await selectedHost.call('knowledgeExport', { id: params.id });
      checkWorkspace();
      const selected = await dialog.showSaveDialog(window, { defaultPath: exported.filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (selected.canceled || !selected.filePath) return { result: null };
      checkWorkspace();
      const temporary = path.join(path.dirname(selected.filePath), `.polaris-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, exported.markdown, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        checkWorkspace(); await rename(temporary, selected.filePath);
      } catch (error) {
        if (error.messageKey) throw error;
        throw Object.assign(new Error('Cannot export this Markdown file.'), { code: 'storage', messageKey: 'knowledge.exportError' });
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
      return { result: { exported: true } };
    }
    return { result: await localHost().call(method, params) };
  }
  catch (error) { return { error: { code: error.code ?? 'storage', message: errorMessage(error, language), ...(error.messageKey ? { messageKey: error.messageKey, params: error.params } : {}) } }; }
});

ipcMain.handle('polaris:layout', async (event, frames) => {
  trusted(event);
  const destination = argument('-PolarisDumpLayout');
  if ((app.isPackaged && process.env.POLARIS_TEST !== '1') || !destination) return;
  if (!frames || typeof frames !== 'object' || JSON.stringify(frames).length > 1_048_576
      || Object.values(frames).some(value => !Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite))) throw new Error('Invalid capture geometry.');
  await writeFile(destination, JSON.stringify(frames));
});
ipcMain.handle('polaris:copy-text', (event, value) => {
  trusted(event);
  if (typeof value !== 'string' || value.length > 65536) throw new Error('Invalid clipboard text.');
  clipboard.writeText(value);
});
ipcMain.handle('polaris:link', async (event, value) => {
  trusted(event);
  const url = typeof value === 'string' && externalURL(value);
  if (url) await shell.openExternal(url);
});

function createWindow() {
  const defaultHeight = Math.max(620, Math.min(1000, screen.getPrimaryDisplay().workAreaSize.height - 32));
  const size = (argument('-PolarisWindowSize') ?? `1440x${defaultHeight}`).split('x').map(Number);
  window = new BrowserWindow({
    width: Math.max(980, size[0] || 1440), height: Math.max(620, size[1] || defaultHeight), minWidth: 980, minHeight: 620,
    title: 'Polaris', titleBarStyle: 'hidden', trafficLightPosition: { x: 10, y: 9 }, backgroundColor: windowBackground(),
    show: false, focusable: !testing, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: !testing },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== (devURL ?? entry)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => {
    if (!testing) window?.show();
    else if (showTestWindow) window?.showInactive();
  });
  window.on('closed', () => { window = undefined; });
  if (devURL) window.loadURL(devURL);
  else window.loadFile(path.join(root, 'dist/index.html'));
}

function updateMenu() {
  const t = translator(language);
  const role = (name, key = name) => ({ role: name, label: t(`menu.${key}`) });
  const menu = Menu.buildFromTemplate([
    { label: 'Polaris', submenu: [role('about'), { type: 'separator' }, { label: t('settings.title') + '…', accelerator: 'Command+,', click: () => {
      if (!window) { settingsOnLaunch = true; createWindow(); }
      else window.webContents.send('polaris:open-settings');
    } }, { type: 'separator' }, role('services'), { type: 'separator' }, role('hide'), role('hideOthers'), role('unhide'), { type: 'separator' }, role('quit')] },
    { role: 'fileMenu', label: t('menu.file') },
    { role: 'editMenu', label: t('menu.edit') },
    { label: t('menu.view'), submenu: [role('togglefullscreen', 'fullscreen')] },
    { role: 'windowMenu', label: t('menu.window') },
  ]);
  const labels = { close: 'close', undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectall: 'selectAll', minimize: 'minimize', zoom: 'zoom' };
  for (const item of menu.items) for (const child of item.submenu?.items ?? []) {
    const key = labels[child.role?.toLowerCase()];
    if (key) child.label = t(`menu.${key}`);
  }
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  app.setName('Polaris');
  languagePreference = languageArgument ? matchLanguage(languageArgument.replace(/[()\"']/g, '').trim()) ?? 'auto' : await readLanguagePreference(preferencesFile).catch(() => 'auto');
  language = resolveLanguage(languagePreference, app.getPreferredSystemLanguages());
  // Tests stay light unless they choose an appearance, so their screenshots do not depend on the Mac's setting.
  appearance = await readAppearancePreference(preferencesFile, testing ? 'light' : 'system').catch(() => 'system');
  nativeTheme.themeSource = appearance;
  // With System selected, macOS appearance changes arrive here; the renderer takes its theme from config.dark.
  nativeTheme.on('updated', () => {
    window?.setBackgroundColor(windowBackground());
    window?.webContents.send('polaris:config-changed', desktopConfig());
  });
  updateMenu();
  app.on('activate', () => { if (!window) createWindow(); });
  app.on('window-all-closed', () => {}); // Closing a macOS window keeps its application menu available.
  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    quittingWorkspace = true; clearTimeout(workspaceTimer);
    void (host?.shutdown() ?? Promise.resolve()).finally(() => app.quit());
  });
  powerMonitor.on('resume', () => { void maintainWorkspace(); });
  createWindow();
  void maintainWorkspace();
});
