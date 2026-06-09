const { app, BrowserWindow, dialog, ipcMain, powerMonitor, Notification, Tray, Menu, shell, net, clipboard, nativeImage } = require('electron');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const {
  SQLITE_FILE_NAME,
  createSqliteStateStore,
  initializeSqliteEngine,
} = require('./sqlite-state-store.cjs');

const POLL_INTERVAL_MS = 1000;
const MAX_SESSIONS = 60000;
const MAX_PROCESS_TIMELINE_RECORDS = 100000;
const MAX_INPUT_ACTIVITY_TIMELINE_RECORDS = 100000;
const MAX_POWER_EVENTS = 5000;
const DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS = 60;
const DEFAULT_ANALYTICS_WINDOW_ITEM_LIMIT = 10;
const INPUT_ACTIVITY_BUCKET_MS = 10 * 60 * 1000;
const INPUT_ACTIVITY_FLUSH_DELAY_MS = 1000;
const MOUSE_MOVE_SAMPLE_MS = 120;
const MOUSE_MOVE_MAX_DELTA_PIXELS = 3000;
const CLIPBOARD_POLL_INTERVAL_MS = 800;
const CLIPBOARD_HISTORY_LIMIT = 300;
const CLIPBOARD_OWN_WRITE_IGNORE_MS = 2500;

const DESKTOP_KEY = 'desktop';
const BROWSER_DOMAIN_KEY_PREFIX = 'browser-domain';
const PROCESS_WHITELIST_KEY_PREFIX = 'process-whitelist';
const DEFAULT_CATEGORY = '其他';
const DESKTOP_CATEGORY = '休息';
const DEFAULT_DISPLAY_MODE = '显示性质';
const BUILTIN_COMPLETION_SOUND_ID = 'builtin-completion';
const BUILTIN_WARNING_SOUND_ID = 'builtin-warning';
const DEFAULT_STORAGE_DIR_NAME = 'state-data';
const LEGACY_STATE_FILE_NAME = 'app-state.json';
const STORAGE_META_FILE_NAME = 'state-meta.json';
const LOG_DIR_NAME = 'logs';
const LOG_FILE_NAME = 'app.log';
const MAX_DIAGNOSTIC_LOGS = 500;
const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const GITHUB_OWNER = 'kewuuuu';
const GITHUB_REPO = 'KewuToolbox';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const GITHUB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATER_CMD_NAME = 'KewuToolboxUpdater.cmd';
const UPDATER_PS1_NAME = 'KewuToolboxUpdater.ps1';
const WINDOWS_RUN_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTO_LAUNCH_REGISTRY_VALUE_NAME = 'KewuToolbox';
const LEGACY_AUTO_LAUNCH_REGISTRY_VALUE_NAMES = ['electron.app.Electron', 'electron.app.KewuToolbox'];
const AUTO_LAUNCH_HIDDEN_ARG = '--kewu-start-hidden-to-tray';
const LOADED_SECTION_KEYS_PROPERTY = '__loadedSectionKeys';

const STATE_SECTION_FILES = {
  profiles: 'profiles.json',
  sessions: 'sessions.json',
  windowStats: 'window-stats.json',
  processTimeline: 'process-timeline.json',
  inputActivityStats: 'input-activity-stats.json',
  inputActivityTimeline: 'input-activity-timeline.json',
  currentProcessKeys: 'current-process-keys.json',
  processTags: 'process-tags.json',
  processTagAssignments: 'process-tag-assignments.json',
  processTagStats: 'process-tag-stats.json',
  soundFiles: 'sound-files.json',
  preferences: 'preferences.json',
  subjects: 'subjects.json',
  queue: 'queue.json',
  pomodoroSettings: 'pomodoro-settings.json',
  stopwatchRecords: 'stopwatch-records.json',
  countdownTasks: 'countdown-tasks.json',
  todos: 'todos.json',
  archives: 'archives.json',
  powerEvents: 'power-events.json',
  pluginConnections: 'plugin-connections.json',
  currentFocusedWindow: 'current-focused-window.json',
  isWindowHiddenToTray: 'window-hidden-to-tray.json',
  displayMode: 'display-mode.json',
  uiState: 'ui-state.json',
  runtimeState: 'runtime-state.json',
  diagnosticLogs: 'diagnostic-logs.json',
};

const BROWSER_BRIDGE_PORT = 17321;
const BROWSER_BRIDGE_ROUTE = '/browser-bridge';
const PLUGIN_BRIDGE_ROUTE = '/plugin-bridge';
const BROWSER_BRIDGE_HEALTH_ROUTE = '/health';
const BROWSER_BRIDGE_STALE_MS = 90 * 1000;

const BROWSER_PROCESS_TO_ID = {
  'chrome.exe': 'chrome',
  'msedge.exe': 'edge',
  'brave.exe': 'brave',
  'firefox.exe': 'firefox',
  'opera.exe': 'opera',
  'vivaldi.exe': 'vivaldi',
};
const BROWSER_PROCESS_NAMES = new Set(Object.keys(BROWSER_PROCESS_TO_ID));
const VS_CODE_PROCESS_NAMES = new Set(['code.exe', 'code - insiders.exe', 'codium.exe']);
const PORTABLE_DATA_DIR_NAME = 'data';
const STORAGE_CONFIG_FILE_NAME = 'storage-config.json';
const PACKAGED_RUNTIME_DIR_NAME = 'electron-runtime';
const CODE_WINDOW_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let monitorTimer = null;
let saveTimer = null;
let inputActivityFlushTimer = null;
let clipboardTimer = null;
let lastClipboardSignature = '';
let lastAppClipboardWriteSignature = '';
let lastAppClipboardWriteAtMs = 0;
let clipboardListenerProcess = null;
let clipboardListenerStdoutBuffer = '';
let isStoppingClipboardMonitoring = false;
let activeWinApi = null;
let inputHookApi = null;
let inputHookStarted = false;
let browserBridgeServer = null;
let sqliteStateStore = null;
let resolvedDataDirPath = null;
let preferredDataDirPath = null;
let appTray = null;
let forceQuitRequested = false;
let isHandlingCloseDecision = false;

/** @type {import('../src/types').AppState} */
let appState = createEmptyState();
let consoleCaptureInstalled = false;

const monitorCursor = {
  lastTickAtMs: null,
  carryMs: 0,
  activeSessionId: null,
  activeClassificationKey: null,
  activeTagId: null,
  tagFocusStreakSeconds: 0,
};

const browserBridgeState = {
  /** @type {Map<string, {activeDomain: string | null, activeUrl: string | null, openDomains: string[], openUrls: string[], updatedAtMs: number, updatedAtIso: string}>} */
  byBrowser: new Map(),
};

const pluginBridgeState = {
  /** @type {Map<string, {pluginId: string, pluginName: string, pluginVersion: string, protocolVersion?: string, homepageUrl?: string, source?: string, isOfficial?: boolean, records: any[], suppressRules: any[], focusedClassificationKey: string | null, focusedClassificationKeys: string[], connectedAt: string, updatedAtMs: number, updatedAtIso: string}>} */
  byPlugin: new Map(),
};

const pendingWindowRuntime = new Map();
const recentlyClosedWindowRuntime = new Map();
const codeWindowIdentityCache = new Map();

const inputHookRuntime = {
  lastMousePoint: null,
  lastMouseMoveAtMs: 0,
};

function formatConsoleArg(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createDefaultSoundFiles(now = new Date().toISOString()) {
  return [
    {
      id: BUILTIN_COMPLETION_SOUND_ID,
      name: '系统提示音（到点）',
      filePath: 'sounds/builtin_completion.wav',
      defaultVolumeMultiplier: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BUILTIN_WARNING_SOUND_ID,
      name: '系统警告音（偏离）',
      filePath: 'sounds/builtin_warning.wav',
      defaultVolumeMultiplier: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createEmptyState() {
  return {
    profiles: [],
    sessions: [],
    windowStats: [],
    processTimeline: [],
    inputActivityStats: [],
    inputActivityTimeline: [],
    currentProcessKeys: [],
    currentProcessRuntimeStats: [],
    processTags: [],
    processTagAssignments: [],
    processTagStats: [],
    soundFiles: createDefaultSoundFiles(),
    preferences: {
      recordWindowThresholdSeconds: DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS,
      analyticsWindowItemLimit: DEFAULT_ANALYTICS_WINDOW_ITEM_LIMIT,
      uiTheme: 'dark',
      autoLaunchEnabled: false,
      processWhitelist: [],
      processBlacklist: createDefaultProcessBlacklistRules(),
      countdownCompletedTaskBehavior: 'keep',
      closeWindowBehavior: 'ask',
    },
    subjects: [],
    queue: [],
    pomodoroSettings: {
      focusMinutes: 25,
      breakMinutes: 5,
      distractionThresholdMinutes: 1,
      distractionMode: '连续',
      notifyEnabled: true,
      soundEnabled: true,
      completionSoundFileId: BUILTIN_COMPLETION_SOUND_ID,
      completionVolumeMode: 'unbalanced',
      completionVolumeMultiplier: 1,
      completionBalancedTargetDb: -18,
      distractionSoundFileId: BUILTIN_WARNING_SOUND_ID,
      distractionVolumeMode: 'unbalanced',
      distractionVolumeMultiplier: 1,
      distractionBalancedTargetDb: -18,
      countdownSoundFileId: BUILTIN_COMPLETION_SOUND_ID,
      countdownVolumeMode: 'unbalanced',
      countdownVolumeMultiplier: 1,
      countdownBalancedTargetDb: -18,
      cycleCount: 0,
    },
    stopwatchRecords: [],
    countdownTasks: [],
    todos: [],
    archives: [],
    powerEvents: [],
    pluginConnections: [],
    diagnosticLogs: [],
    dataDirectoryPath: '',
    logFilePath: '',
    currentFocusedWindow: null,
    isWindowHiddenToTray: false,
    displayMode: DEFAULT_DISPLAY_MODE,
    uiState: {
      calculatorExpression: '',
      monitoring: {
        activeTab: 'history',
        historySort: {
          key: 'lastFocus',
          direction: 'desc',
        },
        currentSort: {
          key: 'lastFocus',
          direction: 'desc',
        },
      },
      clock: {
        newCountdownTitle: '',
        newCountdownSeconds: String(5 * 60),
      },
    },
    runtimeState: {
      pomodoro: {
        secondsLeft: 25 * 60,
        isRunning: false,
        hasStartedCurrentStage: false,
        currentCycle: 1,
        currentQueueIdx: 0,
        offTargetSeconds: 0,
        offTargetAccumulatedMs: 0,
        distractionAlerted: false,
      },
      stopwatch: {
        isRunning: false,
        elapsedMs: 0,
        laps: [],
      },
    },
  };
}

function createDefaultProcessBlacklistRules(now = new Date().toISOString()) {
  return [
    {
      id: 'bl-default-explorer-app-window',
      typePattern: 'AppWindow',
      processPattern: 'explorer.exe',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function getStorageConfigPath() {
  if (app.isPackaged) {
    return path.join(getPackagedDataDir(), STORAGE_CONFIG_FILE_NAME);
  }
  return path.join(app.getPath('userData'), STORAGE_CONFIG_FILE_NAME);
}

function resolvePackagedExecutableDir() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    typeof process.env.PORTABLE_EXECUTABLE_FILE === 'string'
      ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
      : null,
    (() => {
      try {
        const exePath = app.getPath('exe');
        return exePath ? path.dirname(exePath) : null;
      } catch {
        return null;
      }
    })(),
    process.execPath ? path.dirname(process.execPath) : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    return path.resolve(trimmed);
  }

  return path.resolve(process.cwd());
}

function getPackagedDataDir() {
  return path.join(resolvePackagedExecutableDir(), PORTABLE_DATA_DIR_NAME);
}

function getPackagedRuntimeDir() {
  return path.join(getPackagedDataDir(), PACKAGED_RUNTIME_DIR_NAME);
}

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch {
    // Ignore path creation errors here; downstream logic will handle failures.
  }
}

function configurePackagedRuntimePaths() {
  if (!app.isPackaged) {
    return;
  }

  const runtimeBaseDir = getPackagedRuntimeDir();
  const userDataDir = path.join(runtimeBaseDir, 'user-data');
  const sessionDataDir = path.join(runtimeBaseDir, 'session-data');
  const crashDumpsDir = path.join(runtimeBaseDir, 'crash-dumps');
  const logsDir = path.join(runtimeBaseDir, 'logs');

  ensureDir(runtimeBaseDir);
  ensureDir(userDataDir);
  ensureDir(sessionDataDir);
  ensureDir(crashDumpsDir);
  ensureDir(logsDir);

  try {
    app.setPath('userData', userDataDir);
  } catch {
    // Ignore and keep Electron defaults.
  }

  try {
    app.setPath('sessionData', sessionDataDir);
  } catch {
    // Ignore and keep Electron defaults.
  }

  try {
    app.setPath('crashDumps', crashDumpsDir);
  } catch {
    // Ignore and keep Electron defaults.
  }

  try {
    app.setAppLogsPath(logsDir);
  } catch {
    // Ignore and keep Electron defaults.
  }
}

function resolveDataDirInput(inputPath) {
  if (typeof inputPath !== 'string') {
    return null;
  }
  let candidate = inputPath.trim();
  if (!candidate) {
    return null;
  }
  if (!path.isAbsolute(candidate)) {
    candidate = path.resolve(candidate);
  }

  const looksLikeFile = path.extname(candidate).trim() === '.json';
  if (looksLikeFile) {
    return path.dirname(candidate);
  }
  return candidate;
}

function getLegacyStateFilePath(dataDirPath) {
  return path.join(dataDirPath, LEGACY_STATE_FILE_NAME);
}

function getStateMetaPath(dataDirPath) {
  return path.join(dataDirPath, STORAGE_META_FILE_NAME);
}

function getLogFilePath(dataDirPath = getStatePath()) {
  return path.join(dataDirPath, LOG_DIR_NAME, LOG_FILE_NAME);
}

function getSectionFilePath(dataDirPath, sectionKey) {
  const fileName = STATE_SECTION_FILES[sectionKey];
  if (!fileName) {
    return null;
  }
  return path.join(dataDirPath, fileName);
}

function getSqliteStateFilePath(dataDirPath = getStatePath()) {
  return path.join(dataDirPath, SQLITE_FILE_NAME);
}

function getSqliteStateStore(dataDirPath = getStatePath()) {
  const normalizedPath = path.resolve(dataDirPath);
  if (sqliteStateStore && path.resolve(sqliteStateStore.dataDirPath) === normalizedPath) {
    return sqliteStateStore;
  }

  if (sqliteStateStore) {
    sqliteStateStore.close();
  }
  sqliteStateStore = createSqliteStateStore(normalizedPath, Object.keys(STATE_SECTION_FILES));
  return sqliteStateStore;
}

function ensureWritableDataDir(dataDirPath) {
  try {
    ensureDir(dataDirPath);
    const probePath = path.join(dataDirPath, '.write-probe');
    fs.writeFileSync(probePath, 'ok', 'utf8');
    fs.unlinkSync(probePath);
    return true;
  } catch {
    return false;
  }
}

function ensureWritableLogFile(logFilePath) {
  try {
    ensureDir(path.dirname(logFilePath));
    if (!fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, '', 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function formatLogLine(level, message, detail) {
  const nowIso = new Date().toISOString();
  const detailText = typeof detail === 'string' && detail.trim() ? ` | ${detail.trim()}` : '';
  return `[${nowIso}] [${level.toUpperCase()}] ${message}${detailText}`;
}

function appendLogToFile(level, message, detail = '') {
  const logFilePath = getLogFilePath();
  if (!ensureWritableLogFile(logFilePath)) {
    return;
  }
  const line = `${formatLogLine(level, message, detail)}\n`;
  try {
    const stats = fs.statSync(logFilePath);
    if (stats.size > MAX_LOG_FILE_SIZE_BYTES) {
      const rotatedPath = `${logFilePath}.1`;
      try {
        if (fs.existsSync(rotatedPath)) {
          fs.unlinkSync(rotatedPath);
        }
      } catch {
        // Ignore deletion failure for rotated log.
      }
      try {
        fs.renameSync(logFilePath, rotatedPath);
      } catch {
        // Ignore rotate failure and continue append.
      }
    }
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // Ignore file append failures.
  }
}

function addDiagnosticLog(level, message, detail = '') {
  const normalizedLevel = level === 'error' || level === 'warn' ? level : 'info';
  const entry = {
    id: makeId('log'),
    level: normalizedLevel,
    message: typeof message === 'string' ? message : String(message ?? ''),
    detail: typeof detail === 'string' ? detail : String(detail ?? ''),
    occurredAt: new Date().toISOString(),
  };

  appState.diagnosticLogs = [...(appState.diagnosticLogs || []), entry];
  if (appState.diagnosticLogs.length > MAX_DIAGNOSTIC_LOGS) {
    appState.diagnosticLogs = appState.diagnosticLogs.slice(-MAX_DIAGNOSTIC_LOGS);
  }

  appendLogToFile(normalizedLevel, entry.message, entry.detail);
}

function setupConsoleCapture() {
  if (consoleCaptureInstalled) {
    return;
  }
  consoleCaptureInstalled = true;

  const levels = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const joined = args.map(arg => formatConsoleArg(arg)).join(' ');
      const normalizedLevel = level === 'error' || level === 'warn' ? level : 'info';
      addDiagnosticLog(normalizedLevel, joined.slice(0, 5000));
      emitState();
    };
  }
}

function syncStorageMetaToState() {
  appState.dataDirectoryPath = getStatePath();
  appState.logFilePath = getLogFilePath();
}

function readJsonStateSections(dataDirPath) {
  const rawState = {};
  let hasSection = false;
  const loadedSectionKeys = new Set();
  for (const sectionKey of Object.keys(STATE_SECTION_FILES)) {
    const sectionPath = getSectionFilePath(dataDirPath, sectionKey);
    if (!sectionPath || !fs.existsSync(sectionPath)) {
      continue;
    }
    const section = readJsonSafe(sectionPath);
    if (section === null) {
      continue;
    }
    hasSection = true;
    loadedSectionKeys.add(sectionKey);
    rawState[sectionKey] = section;
  }
  if (hasSection) {
    Object.defineProperty(rawState, LOADED_SECTION_KEYS_PROPERTY, {
      value: loadedSectionKeys,
      enumerable: false,
      configurable: true,
    });
  }
  return hasSection ? rawState : null;
}

function readLegacyJsonState(dataDirPath) {
  const sectionState = readJsonStateSections(dataDirPath);
  const singleFileState = readJsonSafe(getLegacyStateFilePath(dataDirPath));
  if (sectionState && singleFileState && typeof sectionState === 'object' && typeof singleFileState === 'object') {
    return {
      ...singleFileState,
      ...sectionState,
    };
  }
  return sectionState || singleFileState;
}

function readStateSections(dataDirPath) {
  try {
    return getSqliteStateStore(dataDirPath).readState();
  } catch (error) {
    addDiagnosticLog(
      'error',
      'SQLite state read failed',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function backfillMissingLegacyStateSections(rawState, legacyRaw) {
  if (!rawState || !legacyRaw || typeof rawState !== 'object' || typeof legacyRaw !== 'object') {
    return { rawState, changed: false };
  }

  const loadedSectionKeys =
    rawState[LOADED_SECTION_KEYS_PROPERTY] instanceof Set
      ? rawState[LOADED_SECTION_KEYS_PROPERTY]
      : new Set(Object.keys(rawState));
  let changed = false;
  const nextRaw = { ...rawState };

  for (const sectionKey of Object.keys(STATE_SECTION_FILES)) {
    if (loadedSectionKeys.has(sectionKey)) {
      continue;
    }
    const legacyValue = legacyRaw[sectionKey];
    if (Array.isArray(legacyValue) && legacyValue.length > 0) {
      nextRaw[sectionKey] = legacyValue;
      changed = true;
    }
  }

  return { rawState: changed ? nextRaw : rawState, changed };
}

function writeStateSections(dataDirPath, statePayload) {
  if (!ensureWritableDataDir(dataDirPath)) {
    return false;
  }

  try {
    return getSqliteStateStore(dataDirPath).writeState(statePayload);
  } catch (error) {
    addDiagnosticLog(
      'error',
      'SQLite state write failed',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function getDefaultStatePath() {
  if (!app.isPackaged) {
    return path.join(app.getPath('userData'), DEFAULT_STORAGE_DIR_NAME);
  }
  return path.join(getPackagedDataDir(), DEFAULT_STORAGE_DIR_NAME);
}

function getPreviousDefaultStateFilePath() {
  if (!app.isPackaged) {
    return path.join(app.getPath('userData'), LEGACY_STATE_FILE_NAME);
  }
  return path.join(getPackagedDataDir(), LEGACY_STATE_FILE_NAME);
}

configurePackagedRuntimePaths();

function loadStorageConfig() {
  const config = readJsonSafe(getStorageConfigPath());
  const configuredPath = resolveDataDirInput(config?.dataDirectoryPath ?? config?.stateFilePath);
  preferredDataDirPath = configuredPath;
  return configuredPath;
}

function persistStorageConfig() {
  const payload = {
    dataDirectoryPath: preferredDataDirPath || '',
    // Keep legacy field for backward compatibility.
    stateFilePath: preferredDataDirPath || '',
    updatedAt: new Date().toISOString(),
  };
  writeJsonSafe(getStorageConfigPath(), payload);
}

function getStatePath() {
  if (resolvedDataDirPath) {
    return resolvedDataDirPath;
  }

  resolvedDataDirPath = preferredDataDirPath || getDefaultStatePath();
  return resolvedDataDirPath;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'favicon.ico'),
    path.join(__dirname, '..', 'dist', 'favicon.ico'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'favicon.ico'),
    path.join(process.resourcesPath || '', 'dist', 'favicon.ico'),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function showMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return true;
  }

  try {
    mainWindow.setSkipTaskbar(false);
  } catch {
    // Ignore skip-taskbar errors.
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  setWindowHiddenToTray(false);
  return true;
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (!appTray) {
    createTray();
  }
  if (!appTray) {
    return false;
  }

  try {
    mainWindow.setSkipTaskbar(true);
  } catch {
    // Ignore skip-taskbar errors.
  }
  mainWindow.hide();
  setWindowHiddenToTray(true);
  return true;
}

function createTray() {
  if (appTray) {
    return;
  }

  const iconPath = resolveAppIconPath();
  if (!iconPath || !fs.existsSync(iconPath)) {
    return;
  }

  appTray = new Tray(iconPath);
  appTray.setToolTip('KewuToolbox');
  appTray.on('double-click', () => {
    showMainWindowFromTray();
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => showMainWindowFromTray(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Exit',
      click: () => {
        forceQuitRequested = true;
        app.quit();
      },
    },
  ]);
  appTray.setContextMenu(contextMenu);
}

function setWindowHiddenToTray(hidden) {
  const normalized = Boolean(hidden);
  if (appState.isWindowHiddenToTray === normalized) {
    return;
  }
  appState.isWindowHiddenToTray = normalized;
  scheduleSave();
  emitState();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function categoryFromExistingOrDefault(existingCategory, isDesktop) {
  if (typeof existingCategory === 'string' && existingCategory.trim()) {
    return existingCategory;
  }
  return isDesktop ? DESKTOP_CATEGORY : DEFAULT_CATEGORY;
}

function normalizeRecordWindowThresholdSeconds(input, fallback = DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeAnalyticsWindowItemLimit(input, fallback = DEFAULT_ANALYTICS_WINDOW_ITEM_LIMIT) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeUiTheme(input, fallback = 'dark') {
  return input === 'light' ? 'light' : fallback;
}

function normalizeAutoLaunchEnabled(input, fallback = false) {
  if (typeof input === 'boolean') {
    return input;
  }
  return fallback;
}

function normalizeCountdownCompletedTaskBehavior(input, fallback = 'keep') {
  return input === 'delete' ? 'delete' : fallback;
}

function normalizeCloseWindowBehavior(input, fallback = 'ask') {
  return input === 'close' || input === 'tray' || input === 'ask' ? input : fallback;
}

function quoteWindowsCommandLineArg(value) {
  return `"${String(value ?? '').replace(/"/g, '\\"')}"`;
}

function parseExecutablePathFromCommand(command) {
  const text = typeof command === 'string' ? command.trim() : '';
  if (!text) {
    return null;
  }
  const quoted = /^"([^"]+\.exe)"(?:\s|$)/i.exec(text);
  if (quoted) {
    return quoted[1];
  }
  const unquoted = /^(.+?\.exe)(?:\s|$)/i.exec(text);
  return unquoted ? unquoted[1].trim() : null;
}

function isKewuAutoLaunchCommand(command) {
  const text = typeof command === 'string' ? command.toLowerCase() : '';
  return text.includes('kewutoolbox');
}

function shouldStartHiddenToTray() {
  return process.argv.some(arg => arg === AUTO_LAUNCH_HIDDEN_ARG);
}

function runWindowsRegistryCommand(args) {
  return childProcess.execFileSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readWindowsRunValue(valueName) {
  try {
    const output = runWindowsRegistryCommand(['query', WINDOWS_RUN_REGISTRY_KEY, '/v', valueName]);
    const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+(.+)$`, 'im');
    const match = pattern.exec(output);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function writeWindowsRunValue(valueName, command) {
  runWindowsRegistryCommand([
    'add',
    WINDOWS_RUN_REGISTRY_KEY,
    '/v',
    valueName,
    '/t',
    'REG_SZ',
    '/d',
    command,
    '/f',
  ]);
}

function deleteWindowsRunValue(valueName) {
  try {
    runWindowsRegistryCommand(['delete', WINDOWS_RUN_REGISTRY_KEY, '/v', valueName, '/f']);
  } catch {
    // Missing registry values do not need cleanup.
  }
}

function cleanupLegacyAutoLaunchEntries() {
  for (const valueName of LEGACY_AUTO_LAUNCH_REGISTRY_VALUE_NAMES) {
    const existing = readWindowsRunValue(valueName);
    if (isKewuAutoLaunchCommand(existing)) {
      deleteWindowsRunValue(valueName);
    }
  }
}

function resolveAutoLaunchExecutablePath() {
  const resolved = resolveCurrentExecutablePath();
  if (resolved) {
    return resolved;
  }
  return process.execPath ? path.resolve(process.execPath) : null;
}

function readSystemAutoLaunchEnabled() {
  if (process.platform === 'win32') {
    const command = readWindowsRunValue(AUTO_LAUNCH_REGISTRY_VALUE_NAME);
    if (!command) {
      return false;
    }
    const executablePath = parseExecutablePathFromCommand(command);
    return Boolean(executablePath && fs.existsSync(executablePath));
  }

  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return false;
  }
}

function applySystemAutoLaunchEnabled(enabled) {
  const normalized = Boolean(enabled);
  if (process.platform === 'win32') {
    cleanupLegacyAutoLaunchEntries();
    if (!normalized) {
      deleteWindowsRunValue(AUTO_LAUNCH_REGISTRY_VALUE_NAME);
      return readSystemAutoLaunchEnabled();
    }

    const executablePath = resolveAutoLaunchExecutablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
      addDiagnosticLog('error', '开机自启动写入失败', `无法定位真实可执行文件：${executablePath || '空路径'}`);
      return false;
    }

    try {
      writeWindowsRunValue(
        AUTO_LAUNCH_REGISTRY_VALUE_NAME,
        `${quoteWindowsCommandLineArg(executablePath)} ${AUTO_LAUNCH_HIDDEN_ARG}`,
      );
    } catch (error) {
      addDiagnosticLog(
        'error',
        '开机自启动写入失败',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }

    return readSystemAutoLaunchEnabled();
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: normalized,
      path: resolveAutoLaunchExecutablePath() || process.execPath,
      args: [AUTO_LAUNCH_HIDDEN_ARG],
    });
  } catch {
    // Ignore and read back current status.
  }
  return readSystemAutoLaunchEnabled();
}

function normalizeDomain(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  try {
    const hasProtocol = /^https?:\/\//.test(trimmed);
    const url = new URL(hasProtocol ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    return host || null;
  } catch {
    return null;
  }
}

function normalizeBrowserId(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value.includes('edge')) return 'edge';
  if (value.includes('chrome')) return 'chrome';
  if (value.includes('firefox')) return 'firefox';
  if (value.includes('brave')) return 'brave';
  if (value.includes('opera')) return 'opera';
  if (value.includes('vivaldi')) return 'vivaldi';
  return value;
}

function safeParseDomainFromUrl(maybeUrl) {
  if (typeof maybeUrl !== 'string') {
    return null;
  }
  return normalizeDomain(maybeUrl);
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, payload) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function normalizeWebUrl(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const hasProtocol = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(hasProtocol ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./i, '').replace(/\.$/, '').toLowerCase();
    if (!host) {
      return null;
    }

    let pathname = parsed.pathname || '/';
    if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${parsed.protocol}//${host}${pathname}`;
  } catch {
    return null;
  }
}

function normalizePatternInput(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeWhitelistName(input, fallbackName) {
  if (typeof input === 'string' && input.trim()) {
    return input.trim();
  }
  return fallbackName;
}

function normalizeProcessWhitelistRules(raw, fallback = []) {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const legacyPattern = normalizePatternInput(item.pattern);
      const namePattern = normalizePatternInput(item.namePattern) || legacyPattern;
      const typePattern = normalizePatternInput(item.typePattern);
      const processPattern = normalizePatternInput(item.processPattern);
      if (!namePattern && !typePattern && !processPattern) {
        return null;
      }
      const now = new Date().toISOString();
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('wl'),
        name: normalizeWhitelistName(item.name, namePattern || typePattern || processPattern || '白名单规则'),
        namePattern: namePattern || undefined,
        typePattern: typePattern || undefined,
        processPattern: processPattern || undefined,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
      };
    })
    .filter(Boolean);
}

function normalizeProcessBlacklistRules(raw, fallback = []) {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const namePattern = normalizePatternInput(item.namePattern);
      const typePattern = normalizePatternInput(item.typePattern);
      const processPattern = normalizePatternInput(item.processPattern);
      if (!namePattern && !typePattern && !processPattern) {
        return null;
      }
      const now = new Date().toISOString();
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('bl'),
        namePattern: namePattern || undefined,
        typePattern: typePattern || undefined,
        processPattern: processPattern || undefined,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
      };
    })
    .filter(Boolean);
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexBody}$`, 'i');
}

function wildcardMatch(pattern, value) {
  const normalizedPattern = normalizePatternInput(pattern);
  if (!normalizedPattern || typeof value !== 'string' || !value) {
    return false;
  }
  try {
    return wildcardToRegExp(normalizedPattern).test(value);
  } catch {
    return false;
  }
}

function matchesRuleField(pattern, values) {
  const normalizedPattern = normalizePatternInput(pattern);
  if (!normalizedPattern) {
    return true;
  }
  return values.some(value => wildcardMatch(normalizedPattern, value));
}

function matchesProcessRule(rule, profile) {
  if (!rule || !profile) {
    return false;
  }

  const nameValues = [];
  const pushNameValue = value => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    nameValues.push(normalized);
    nameValues.push(normalized.replace(/^https?:\/\//i, ''));
  };

  pushNameValue(profile.displayName);
  pushNameValue(profile.normalizedTitle);
  pushNameValue(profile.domain);
  if (profile.domain) {
    pushNameValue(`https://${profile.domain}`);
    pushNameValue(`https://${profile.domain}/`);
    pushNameValue(`http://${profile.domain}`);
    pushNameValue(`http://${profile.domain}/`);
    pushNameValue(`www.${profile.domain}`);
    pushNameValue(`https://www.${profile.domain}`);
    pushNameValue(`https://www.${profile.domain}/`);
    pushNameValue(`http://www.${profile.domain}`);
    pushNameValue(`http://www.${profile.domain}/`);
  }

  return (
    matchesRuleField(rule.namePattern, nameValues) &&
    matchesRuleField(rule.typePattern, [profile.objectType || '']) &&
    matchesRuleField(rule.processPattern, [profile.processName || ''])
  );
}

function findMatchingProcessWhitelistRules(profile) {
  if (!profile) {
    return [];
  }
  const rules = appState.preferences?.processWhitelist ?? [];
  return rules.filter(rule => matchesProcessRule(rule, profile));
}

function shouldIgnoreByBlacklist(profile) {
  if (!profile) {
    return false;
  }
  const rules = appState.preferences?.processBlacklist ?? [];
  return rules.some(rule => matchesProcessRule(rule, profile));
}

function applyWhitelistNamesToState() {
  const rules = appState.preferences?.processWhitelist ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const nameMap = new Map();
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string') {
      continue;
    }
    const key = `${PROCESS_WHITELIST_KEY_PREFIX}|${rule.id}`;
    const fallbackName = rule.namePattern || rule.typePattern || rule.processPattern || key;
    nameMap.set(key, normalizeWhitelistName(rule.name, fallbackName));
  }
  if (nameMap.size === 0) {
    return;
  }

  appState.profiles = appState.profiles.map(profile => {
    const nextName = nameMap.get(profile.classificationKey);
    if (!nextName || profile.displayName === nextName) {
      return profile;
    }
    return {
      ...profile,
      displayName: nextName,
      normalizedTitle: nextName,
      updatedAt: nowIso,
    };
  });

  appState.windowStats = appState.windowStats.map(item => {
    const nextName = nameMap.get(item.classificationKey);
    if (!nextName || item.displayName === nextName) {
      return item;
    }
    return {
      ...item,
      displayName: nextName,
    };
  });

  appState.sessions = appState.sessions.map(item => {
    const nextName = nameMap.get(item.classificationKey);
    if (!nextName || item.displayName === nextName) {
      return item;
    }
    return {
      ...item,
      displayName: nextName,
    };
  });

  appState.processTimeline = (appState.processTimeline || []).map(item => {
    const nextName = nameMap.get(item.classificationKey);
    if (!nextName || item.displayName === nextName) {
      return item;
    }
    return {
      ...item,
      displayName: nextName,
    };
  });

  appState.inputActivityStats = (appState.inputActivityStats || []).map(item => {
    const nextName = nameMap.get(item.classificationKey);
    if (!nextName || item.displayName === nextName) {
      return item;
    }
    return {
      ...item,
      displayName: nextName,
    };
  });

  appState.inputActivityTimeline = (appState.inputActivityTimeline || []).map(item => {
    const nextName = nameMap.get(item.classificationKey);
    if (!nextName || item.displayName === nextName) {
      return item;
    }
    return {
      ...item,
      displayName: nextName,
    };
  });

  if (appState.currentFocusedWindow) {
    const nextName = nameMap.get(appState.currentFocusedWindow.classificationKey);
    if (nextName && appState.currentFocusedWindow.displayName !== nextName) {
      appState.currentFocusedWindow = {
        ...appState.currentFocusedWindow,
        displayName: nextName,
        normalizedTitle: nextName,
        updatedAt: nowIso,
      };
    }
  }
}

function getProcessWhitelistKey(rule) {
  return `${PROCESS_WHITELIST_KEY_PREFIX}|${rule.id}`.slice(0, 300);
}

function getLegacyPluginWhitelistKey(rule) {
  return `plugin-whitelist|${rule.id}`;
}

function getWhitelistRuleDisplayName(rule) {
  const fallbackName = rule?.namePattern || rule?.typePattern || rule?.processPattern || rule?.id || '白名单规则';
  return normalizeWhitelistName(rule?.name, fallbackName);
}

function makeWhitelistMergeCandidate(raw, profileMap) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rawKey = typeof raw.classificationKey === 'string' ? raw.classificationKey : '';
  const profile = rawKey ? profileMap.get(rawKey) : null;
  const displayName =
    profile?.displayName ||
    (typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : rawKey);
  const normalizedTitle =
    profile?.normalizedTitle ||
    (typeof raw.normalizedTitle === 'string' && raw.normalizedTitle.trim()
      ? raw.normalizedTitle.trim()
      : typeof raw.windowTitle === 'string' && raw.windowTitle.trim()
        ? raw.windowTitle.trim()
        : typeof raw.browserTabTitle === 'string' && raw.browserTabTitle.trim()
          ? raw.browserTabTitle.trim()
          : displayName);
  const objectType = profile?.objectType || raw.objectType || 'AppWindow';
  const processName =
    profile?.processName ||
    (typeof raw.processName === 'string' && raw.processName.trim() ? raw.processName.trim().toLowerCase() : 'unknown');
  const domain =
    profile?.domain ||
    (typeof raw.domain === 'string' && raw.domain.trim() ? normalizeDomain(raw.domain) || raw.domain.trim() : undefined);
  return {
    classificationKey: rawKey,
    displayName,
    normalizedTitle,
    objectType,
    processName,
    domain,
    category: profile?.category || raw.category || raw.categoryAtThatTime || DEFAULT_CATEGORY,
  };
}

function getMatchingWhitelistRules(candidate, rules) {
  if (!candidate || !Array.isArray(rules) || rules.length === 0) {
    return [];
  }

  return rules.filter(rule => {
    if (!rule || typeof rule.id !== 'string') {
      return false;
    }
    const targetKey = getProcessWhitelistKey(rule);
    if (candidate.classificationKey === targetKey || candidate.classificationKey === getLegacyPluginWhitelistKey(rule)) {
      return true;
    }
    return matchesProcessRule(rule, candidate);
  });
}

function upsertMergedWhitelistProfile(profileMap, rule, source, nowIso) {
  const targetKey = getProcessWhitelistKey(rule);
  const displayName = getWhitelistRuleDisplayName(rule);
  const existing = profileMap.get(targetKey);
  const nextProfile = existing
    ? {
        ...existing,
        displayName,
        normalizedTitle: displayName,
        objectType: existing.objectType || source?.objectType || 'AppWindow',
        processName: existing.processName || source?.processName || 'unknown',
        domain: existing.domain || source?.domain,
        updatedAt: nowIso,
      }
    : {
        id: makeId('profile'),
        classificationKey: targetKey,
        displayName,
        objectType: source?.objectType || 'AppWindow',
        processName: source?.processName || 'unknown',
        browserName: source?.browserName,
        normalizedTitle: displayName,
        domain: source?.domain,
        category: source?.category || DEFAULT_CATEGORY,
        isBuiltIn: false,
        updatedAt: nowIso,
      };
  profileMap.set(targetKey, nextProfile);
  return nextProfile;
}

function mergeNumericStat(map, key, value, merge) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, value);
    return;
  }
  map.set(key, merge(existing, value));
}

function buildWhitelistMergeResult() {
  const rules = appState.preferences?.processWhitelist || [];
  if (!Array.isArray(rules) || rules.length === 0) {
    return { changedCount: 0 };
  }

  const nowIso = new Date().toISOString();
  const originalProfileMap = new Map(appState.profiles.map(profile => [profile.classificationKey, profile]));
  const nextProfileMap = new Map();
  const movedKeyMap = new Map();
  let changedCount = 0;

  const registerMove = (sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }
    if (!movedKeyMap.has(sourceKey)) {
      movedKeyMap.set(sourceKey, new Set());
    }
    movedKeyMap.get(sourceKey).add(targetKey);
  };

  const resolveRules = raw => {
    const candidate = makeWhitelistMergeCandidate(raw, originalProfileMap);
    const matchedRules = getMatchingWhitelistRules(candidate, rules);
    return { candidate, matchedRules };
  };

  for (const profile of appState.profiles) {
    const { candidate, matchedRules } = resolveRules(profile);
    if (!candidate || matchedRules.length === 0) {
      nextProfileMap.set(profile.classificationKey, profile);
      continue;
    }
    let profileChanged = false;
    for (const rule of matchedRules) {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(profile.classificationKey, targetProfile.classificationKey);
      if (targetProfile.classificationKey !== profile.classificationKey || targetProfile.displayName !== profile.displayName) {
        profileChanged = true;
      }
    }
    if (profileChanged) {
      changedCount += 1;
    }
  }

  const transformFocusRecord = session => {
    const { candidate, matchedRules } = resolveRules(session);
    if (!candidate || matchedRules.length === 0) {
      return [session];
    }
    const transformed = matchedRules.map(rule => {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(session.classificationKey, targetProfile.classificationKey);
      const alreadyTarget = session.classificationKey === targetProfile.classificationKey && matchedRules.length === 1;
      return {
        ...session,
        id: alreadyTarget ? session.id : `${session.id}::${rule.id}`,
        classificationKey: targetProfile.classificationKey,
        displayName: targetProfile.displayName,
        objectType: targetProfile.objectType,
        categoryAtThatTime: targetProfile.category,
        processName: targetProfile.processName,
        windowTitle: session.windowTitle || candidate.normalizedTitle || targetProfile.displayName,
        browserTabTitle: session.browserTabTitle,
        domain: targetProfile.domain || session.domain,
      };
    });
    if (transformed.some(item => item.classificationKey !== session.classificationKey || item.displayName !== session.displayName)) {
      changedCount += 1;
    }
    return transformed;
  };

  const transformTimelineRecord = record => {
    const { candidate, matchedRules } = resolveRules(record);
    if (!candidate || matchedRules.length === 0) {
      return [record];
    }
    const transformed = matchedRules.map(rule => {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(record.classificationKey, targetProfile.classificationKey);
      const alreadyTarget = record.classificationKey === targetProfile.classificationKey && matchedRules.length === 1;
      return {
        ...record,
        id: alreadyTarget ? record.id : `${record.id}::${rule.id}`,
        classificationKey: targetProfile.classificationKey,
        displayName: targetProfile.displayName,
        objectType: targetProfile.objectType,
        processName: targetProfile.processName,
        domain: targetProfile.domain || record.domain,
        categoryAtThatTime: targetProfile.category,
      };
    });
    if (transformed.some(item => item.classificationKey !== record.classificationKey || item.displayName !== record.displayName)) {
      changedCount += 1;
    }
    return transformed;
  };

  const transformInputActivityTimelineRecord = record => {
    const { candidate, matchedRules } = resolveRules(record);
    if (!candidate || matchedRules.length === 0) {
      return [record];
    }
    const transformed = matchedRules.map(rule => {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(record.classificationKey, targetProfile.classificationKey);
      const alreadyTarget = record.classificationKey === targetProfile.classificationKey && matchedRules.length === 1;
      return {
        ...record,
        id: alreadyTarget ? record.id : `${record.id}::${rule.id}`,
        classificationKey: targetProfile.classificationKey,
        displayName: targetProfile.displayName,
        objectType: targetProfile.objectType,
        processName: targetProfile.processName,
        domain: targetProfile.domain || record.domain,
      };
    });
    if (transformed.some(item => item.classificationKey !== record.classificationKey || item.displayName !== record.displayName)) {
      changedCount += 1;
    }
    return transformed;
  };

  const nextWindowStatMap = new Map();
  const upsertWindowStat = stat => {
    mergeNumericStat(nextWindowStatMap, stat.classificationKey, stat, (existing, incoming) => ({
      ...existing,
      displayName: incoming.displayName,
      objectType: incoming.objectType,
      processName: incoming.processName,
      domain: incoming.domain || existing.domain,
      category: incoming.category || existing.category,
      totalVisibleSeconds: (Number(existing.totalVisibleSeconds) || 0) + (Number(incoming.totalVisibleSeconds) || 0),
      focusSeconds: (Number(existing.focusSeconds) || 0) + (Number(incoming.focusSeconds) || 0),
      lastFocusAt:
        new Date(incoming.lastFocusAt || 0).getTime() > new Date(existing.lastFocusAt || 0).getTime()
          ? incoming.lastFocusAt
          : existing.lastFocusAt,
      longestContinuousFocusSeconds: Math.max(
        Number(existing.longestContinuousFocusSeconds) || 0,
        Number(incoming.longestContinuousFocusSeconds) || 0,
      ),
    }));
  };

  for (const stat of appState.windowStats || []) {
    const { candidate, matchedRules } = resolveRules(stat);
    if (!candidate || matchedRules.length === 0) {
      upsertWindowStat(stat);
      continue;
    }
    for (const rule of matchedRules) {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(stat.classificationKey, targetProfile.classificationKey);
      upsertWindowStat({
        ...stat,
        classificationKey: targetProfile.classificationKey,
        displayName: targetProfile.displayName,
        objectType: targetProfile.objectType,
        processName: targetProfile.processName,
        domain: targetProfile.domain || stat.domain,
        category: targetProfile.category,
      });
    }
    changedCount += 1;
  }

  const nextInputActivityStatMap = new Map();
  const mergeKeyCountMaps = (existing, incoming) => {
    const existingCounts = normalizeInputActivityCounts(existing).keyCounts;
    const incomingCounts = normalizeInputActivityCounts(incoming).keyCounts;
    for (const [keycode, count] of Object.entries(incomingCounts)) {
      existingCounts[keycode] = (Number(existingCounts[keycode]) || 0) + (Number(count) || 0);
    }
    return existingCounts;
  };
  const upsertInputActivityStat = stat => {
    mergeNumericStat(nextInputActivityStatMap, stat.classificationKey, stat, (existing, incoming) => ({
      ...existing,
      displayName: incoming.displayName,
      objectType: incoming.objectType,
      processName: incoming.processName,
      domain: incoming.domain || existing.domain,
      keyPresses: (Number(existing.keyPresses) || 0) + (Number(incoming.keyPresses) || 0),
      leftClicks: (Number(existing.leftClicks) || 0) + (Number(incoming.leftClicks) || 0),
      rightClicks: (Number(existing.rightClicks) || 0) + (Number(incoming.rightClicks) || 0),
      middleClicks: (Number(existing.middleClicks) || 0) + (Number(incoming.middleClicks) || 0),
      sideBackClicks: (Number(existing.sideBackClicks) || 0) + (Number(incoming.sideBackClicks) || 0),
      sideForwardClicks: (Number(existing.sideForwardClicks) || 0) + (Number(incoming.sideForwardClicks) || 0),
      scrollTicks: (Number(existing.scrollTicks) || 0) + (Number(incoming.scrollTicks) || 0),
      mouseMovePixels: (Number(existing.mouseMovePixels) || 0) + (Number(incoming.mouseMovePixels) || 0),
      keyCounts: mergeKeyCountMaps(existing, incoming),
      firstAt:
        new Date(incoming.firstAt || 0).getTime() < new Date(existing.firstAt || 0).getTime()
          ? incoming.firstAt
          : existing.firstAt,
      lastAt:
        new Date(incoming.lastAt || 0).getTime() > new Date(existing.lastAt || 0).getTime()
          ? incoming.lastAt
          : existing.lastAt,
    }));
  };

  for (const stat of appState.inputActivityStats || []) {
    const { candidate, matchedRules } = resolveRules(stat);
    if (!candidate || matchedRules.length === 0) {
      upsertInputActivityStat(stat);
      continue;
    }
    for (const rule of matchedRules) {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(stat.classificationKey, targetProfile.classificationKey);
      upsertInputActivityStat({
        ...stat,
        classificationKey: targetProfile.classificationKey,
        displayName: targetProfile.displayName,
        objectType: targetProfile.objectType,
        processName: targetProfile.processName,
        domain: targetProfile.domain || stat.domain,
      });
    }
    changedCount += 1;
  }

  const nextRuntimeStatMap = new Map();
  const upsertRuntimeStat = stat => {
    mergeNumericStat(nextRuntimeStatMap, stat.classificationKey, stat, (existing, incoming) => ({
      ...existing,
      firstSeenAt:
        new Date(incoming.firstSeenAt || 0).getTime() < new Date(existing.firstSeenAt || 0).getTime()
          ? incoming.firstSeenAt
          : existing.firstSeenAt,
      totalVisibleSeconds: (Number(existing.totalVisibleSeconds) || 0) + (Number(incoming.totalVisibleSeconds) || 0),
      totalFocusSeconds: (Number(existing.totalFocusSeconds) || 0) + (Number(incoming.totalFocusSeconds) || 0),
      currentContinuousFocusSeconds: Math.max(
        Number(existing.currentContinuousFocusSeconds) || 0,
        Number(incoming.currentContinuousFocusSeconds) || 0,
      ),
      longestContinuousFocusSeconds: Math.max(
        Number(existing.longestContinuousFocusSeconds) || 0,
        Number(incoming.longestContinuousFocusSeconds) || 0,
      ),
      lastFocusAt:
        new Date(incoming.lastFocusAt || 0).getTime() > new Date(existing.lastFocusAt || 0).getTime()
          ? incoming.lastFocusAt
          : existing.lastFocusAt,
      recorded: Boolean(existing.recorded || incoming.recorded),
      processTimelineId: existing.processTimelineId,
      focusSegmentStartedAt: existing.focusSegmentStartedAt || incoming.focusSegmentStartedAt,
      focusSegmentRecordedSeconds: Math.max(
        Number(existing.focusSegmentRecordedSeconds) || 0,
        Number(incoming.focusSegmentRecordedSeconds) || 0,
      ),
    }));
  };

  for (const runtime of appState.currentProcessRuntimeStats || []) {
    const { candidate, matchedRules } = resolveRules(runtime);
    if (!candidate || matchedRules.length === 0) {
      upsertRuntimeStat(runtime);
      continue;
    }
    for (const rule of matchedRules) {
      const targetProfile = upsertMergedWhitelistProfile(nextProfileMap, rule, candidate, nowIso);
      registerMove(runtime.classificationKey, targetProfile.classificationKey);
      upsertRuntimeStat({
        ...runtime,
        classificationKey: targetProfile.classificationKey,
        processTimelineId: undefined,
      });
    }
  }

  appState.sessions = (appState.sessions || []).flatMap(transformFocusRecord);
  appState.processTimeline = (appState.processTimeline || []).flatMap(transformTimelineRecord);
  appState.inputActivityTimeline = (appState.inputActivityTimeline || []).flatMap(transformInputActivityTimelineRecord);
  appState.windowStats = [...nextWindowStatMap.values()];
  appState.inputActivityStats = [...nextInputActivityStatMap.values()];
  appState.currentProcessRuntimeStats = [...nextRuntimeStatMap.values()];

  const remapRuntimeMap = sourceMap => {
    const nextMap = new Map();
    for (const [key, pending] of sourceMap.entries()) {
      const movedTargets = movedKeyMap.get(key);
      if (!movedTargets || movedTargets.size === 0) {
        if (nextProfileMap.has(key)) {
          nextMap.set(key, pending);
        }
        continue;
      }
      for (const targetKey of movedTargets) {
        const existing = nextMap.get(targetKey);
        const nextPending = {
          ...pending,
          classificationKey: targetKey,
          processTimelineId: undefined,
        };
        if (!existing) {
          nextMap.set(targetKey, nextPending);
          continue;
        }
        nextMap.set(targetKey, {
          ...existing,
          totalVisibleSeconds:
            (Number(existing.totalVisibleSeconds) || 0) + (Number(nextPending.totalVisibleSeconds) || 0),
          totalFocusSeconds:
            (Number(existing.totalFocusSeconds) || 0) + (Number(nextPending.totalFocusSeconds) || 0),
          currentContinuousFocusSeconds: Math.max(
            Number(existing.currentContinuousFocusSeconds) || 0,
            Number(nextPending.currentContinuousFocusSeconds) || 0,
          ),
          longestContinuousFocusSeconds: Math.max(
            Number(existing.longestContinuousFocusSeconds) || 0,
            Number(nextPending.longestContinuousFocusSeconds) || 0,
          ),
          lastFocusAt:
            new Date(nextPending.lastFocusAt || 0).getTime() > new Date(existing.lastFocusAt || 0).getTime()
              ? nextPending.lastFocusAt
              : existing.lastFocusAt,
          recorded: Boolean(existing.recorded || nextPending.recorded),
        });
      }
    }
    return nextMap;
  };
  const nextPendingWindowRuntime = remapRuntimeMap(pendingWindowRuntime);
  pendingWindowRuntime.clear();
  for (const [key, value] of nextPendingWindowRuntime.entries()) {
    pendingWindowRuntime.set(key, value);
  }
  const nextRecentlyClosedWindowRuntime = remapRuntimeMap(recentlyClosedWindowRuntime);
  recentlyClosedWindowRuntime.clear();
  for (const [key, value] of nextRecentlyClosedWindowRuntime.entries()) {
    recentlyClosedWindowRuntime.set(key, value);
  }

  if (monitorCursor.activeClassificationKey) {
    const movedTargets = movedKeyMap.get(monitorCursor.activeClassificationKey);
    if (movedTargets && movedTargets.size > 0) {
      const targetKey = [...movedTargets][0];
      monitorCursor.activeClassificationKey = targetKey;
      const activeSession = [...appState.sessions]
        .filter(session => session.classificationKey === targetKey)
        .sort((a, b) => new Date(b.endAt || 0).getTime() - new Date(a.endAt || 0).getTime())[0];
      monitorCursor.activeSessionId = activeSession?.id ?? null;
    }
  }

  const nextCurrentKeys = new Set();
  for (const key of appState.currentProcessKeys || []) {
    const movedTargets = movedKeyMap.get(key);
    if (movedTargets && movedTargets.size > 0) {
      for (const targetKey of movedTargets) {
        nextCurrentKeys.add(targetKey);
      }
    } else if (nextProfileMap.has(key)) {
      nextCurrentKeys.add(key);
    }
  }
  appState.currentProcessKeys = [...nextCurrentKeys];

  const moveAssignmentMap = new Map();
  for (const assignment of appState.processTagAssignments || []) {
    const movedTargets = movedKeyMap.get(assignment.classificationKey);
    if (!movedTargets || movedTargets.size === 0) {
      if (nextProfileMap.has(assignment.classificationKey)) {
        moveAssignmentMap.set(assignment.classificationKey, assignment);
      }
      continue;
    }
    for (const targetKey of movedTargets) {
      if (!moveAssignmentMap.has(targetKey)) {
        moveAssignmentMap.set(targetKey, {
          ...assignment,
          classificationKey: targetKey,
          updatedAt: nowIso,
        });
      }
    }
  }
  const validTagSet = new Set(appState.processTags.map(tag => tag.id));
  appState.processTagAssignments = [...moveAssignmentMap.values()].filter(item => validTagSet.has(item.tagId));

  const transformWindowGroup = windowGroup =>
    (Array.isArray(windowGroup) ? windowGroup : []).flatMap(item => {
      if (!item || item.matchMode === 'pattern') {
        return [item];
      }
      const movedTargets = movedKeyMap.get(item.classificationKey);
      if (!movedTargets || movedTargets.size === 0) {
        return [item];
      }
      return [...movedTargets].map(targetKey => {
        const targetProfile = nextProfileMap.get(targetKey);
        return {
          ...item,
          classificationKey: targetKey,
          displayName: targetProfile?.displayName || item.displayName,
          objectType: targetProfile?.objectType || item.objectType,
          processName: targetProfile?.processName || item.processName,
        };
      });
    });

  appState.subjects = (appState.subjects || []).map(subject => ({
    ...subject,
    windowGroup: transformWindowGroup(subject.windowGroup),
    updatedAt: nowIso,
  }));
  appState.queue = (appState.queue || []).map(item => ({
    ...item,
    windowGroup: transformWindowGroup(item.windowGroup),
  }));

  if (appState.currentFocusedWindow) {
    const movedTargets = movedKeyMap.get(appState.currentFocusedWindow.classificationKey);
    if (movedTargets && movedTargets.size > 0) {
      const targetProfile = nextProfileMap.get([...movedTargets][0]);
      appState.currentFocusedWindow = targetProfile || appState.currentFocusedWindow;
    }
  }

  appState.profiles = [...nextProfileMap.values()];
  applyWhitelistNamesToState();
  return { changedCount };
}

function mergeRecordsByCurrentWhitelist() {
  const result = buildWhitelistMergeResult();
  if (result.changedCount > 0) {
    scheduleSave();
    emitState();
  }
  return {
    ok: true,
    changedCount: result.changedCount,
    state: appState,
  };
}

function persistState() {
  syncStorageMetaToState();
  const dataDirPath = getStatePath();
  if (writeStateSections(dataDirPath, appState)) {
    return;
  }

  if (app.isPackaged) {
    return;
  }

  const fallbackDataDir = path.join(app.getPath('userData'), DEFAULT_STORAGE_DIR_NAME);
  if (fallbackDataDir !== dataDirPath && writeStateSections(fallbackDataDir, appState)) {
    applyStatePath(fallbackDataDir);
  }
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistState();
  }, 300);
}

function closeStaleOpenProcessTimelineRecords() {
  const nowIso = new Date().toISOString();
  appState.processTimeline = (appState.processTimeline || []).map(item => {
    if (!item?.isOpen) {
      return item;
    }
    const endAt = typeof item.endAt === 'string' && item.endAt ? item.endAt : nowIso;
    return {
      ...item,
      endAt,
      durationSeconds: Math.max(
        0,
        Math.floor((new Date(endAt).getTime() - new Date(item.startAt).getTime()) / 1000),
      ),
      isOpen: false,
    };
  });
}

function normalizeMonitoringSort(rawSort, fallbackSort) {
  const allowed = new Set([
    'displayName',
    'objectType',
    'processName',
    'category',
    'tag',
    'totalVisible',
    'focusTime',
    'lastFocus',
    'longestContinuousFocus',
  ]);
  const keyCandidate = typeof rawSort?.key === 'string' ? rawSort.key : fallbackSort.key;
  const mappedKey = keyCandidate === 'lastSeen' ? 'lastFocus' : keyCandidate;
  const key = allowed.has(mappedKey) ? mappedKey : fallbackSort.key;
  const direction =
    rawSort?.direction === 'asc' || rawSort?.direction === 'desc'
      ? rawSort.direction
      : fallbackSort.direction;
  return { key, direction };
}

function normalizeWindowRuntimeStat(item) {
  if (!item || typeof item !== 'object' || typeof item.classificationKey !== 'string') {
    return null;
  }

  const lastFocusAt =
    typeof item.lastFocusAt === 'string'
      ? item.lastFocusAt
      : typeof item.lastSeenAt === 'string'
        ? item.lastSeenAt
        : '';
  const longestContinuousFocusSeconds = Number.isFinite(Number(item.longestContinuousFocusSeconds))
    ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
    : 0;

  return {
    classificationKey: item.classificationKey,
    displayName: typeof item.displayName === 'string' ? item.displayName : item.classificationKey,
    objectType: item.objectType === 'BrowserTab' || item.objectType === 'Desktop' ? item.objectType : 'AppWindow',
    processName: typeof item.processName === 'string' ? item.processName : '',
    domain: typeof item.domain === 'string' ? item.domain : undefined,
    category: categoryFromExistingOrDefault(item.category, item.objectType === 'Desktop'),
    totalVisibleSeconds: Number.isFinite(Number(item.totalVisibleSeconds))
      ? Math.max(0, Math.floor(Number(item.totalVisibleSeconds)))
      : 0,
    focusSeconds: Number.isFinite(Number(item.focusSeconds))
      ? Math.max(0, Math.floor(Number(item.focusSeconds)))
      : 0,
    lastFocusAt,
    longestContinuousFocusSeconds,
  };
}

function normalizeProcessTagRuntimeStat(item) {
  if (!item || typeof item !== 'object' || typeof item.tagId !== 'string') {
    return null;
  }
  const lastFocusAt =
    typeof item.lastFocusAt === 'string'
      ? item.lastFocusAt
      : typeof item.lastSeenAt === 'string'
        ? item.lastSeenAt
        : '';
  const longestContinuousFocusSeconds = Number.isFinite(Number(item.longestContinuousFocusSeconds))
    ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
    : 0;

  return {
    tagId: item.tagId,
    totalVisibleSeconds: Number.isFinite(Number(item.totalVisibleSeconds))
      ? Math.max(0, Math.floor(Number(item.totalVisibleSeconds)))
      : 0,
    focusSeconds: Number.isFinite(Number(item.focusSeconds))
      ? Math.max(0, Math.floor(Number(item.focusSeconds)))
      : 0,
    lastFocusAt,
    longestContinuousFocusSeconds,
  };
}

function normalizePendingRuntimeStat(item) {
  if (!item || typeof item !== 'object' || typeof item.classificationKey !== 'string') {
    return null;
  }
  return {
    classificationKey: item.classificationKey,
    firstSeenAt: typeof item.firstSeenAt === 'string' ? item.firstSeenAt : '',
    totalVisibleSeconds: Number.isFinite(Number(item.totalVisibleSeconds))
      ? Math.max(0, Math.floor(Number(item.totalVisibleSeconds)))
      : 0,
    totalFocusSeconds: Number.isFinite(Number(item.totalFocusSeconds))
      ? Math.max(0, Math.floor(Number(item.totalFocusSeconds)))
      : 0,
    currentContinuousFocusSeconds: Number.isFinite(Number(item.currentContinuousFocusSeconds))
      ? Math.max(0, Math.floor(Number(item.currentContinuousFocusSeconds)))
      : 0,
    longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
      ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
      : 0,
    lastFocusAt: typeof item.lastFocusAt === 'string' ? item.lastFocusAt : '',
    recorded: Boolean(item.recorded),
    processTimelineId: typeof item.processTimelineId === 'string' ? item.processTimelineId : undefined,
    focusSegmentStartedAt: typeof item.focusSegmentStartedAt === 'string' ? item.focusSegmentStartedAt : undefined,
    focusSegmentRecordedSeconds: Number.isFinite(Number(item.focusSegmentRecordedSeconds))
      ? Math.max(0, Math.floor(Number(item.focusSegmentRecordedSeconds)))
      : 0,
  };
}

function normalizeProcessTimelineRecord(item) {
  if (!item || typeof item !== 'object' || typeof item.classificationKey !== 'string') {
    return null;
  }
  const nowIso = new Date().toISOString();
  const startAt = typeof item.startAt === 'string' && item.startAt ? item.startAt : nowIso;
  const endAt = typeof item.endAt === 'string' && item.endAt ? item.endAt : startAt;
  const durationSeconds = Number.isFinite(Number(item.durationSeconds))
    ? Math.max(0, Math.floor(Number(item.durationSeconds)))
    : Math.max(0, Math.floor((new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000));

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('process-timeline'),
    classificationKey: item.classificationKey,
    displayName: typeof item.displayName === 'string' ? item.displayName : item.classificationKey,
    objectType: item.objectType === 'BrowserTab' || item.objectType === 'Desktop' ? item.objectType : 'AppWindow',
    processName: typeof item.processName === 'string' ? item.processName : '',
    domain: typeof item.domain === 'string' ? item.domain : undefined,
    categoryAtThatTime:
      typeof item.categoryAtThatTime === 'string'
        ? item.categoryAtThatTime
        : typeof item.category === 'string'
          ? item.category
          : DEFAULT_CATEGORY,
    startAt,
    endAt,
    durationSeconds,
    isOpen: Boolean(item.isOpen),
  };
}

function normalizeInputActivityCounts(item) {
  const pickInteger = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);
  const normalizeKeyCounts = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value).reduce((map, [key, count]) => {
      const keycode = Number(key);
      const normalizedCount = pickInteger(count);
      if (Number.isFinite(keycode) && keycode > 0 && normalizedCount > 0) {
        map[String(Math.floor(keycode))] = normalizedCount;
      }
      return map;
    }, {});
  };
  return {
    keyPresses: pickInteger(item?.keyPresses),
    leftClicks: pickInteger(item?.leftClicks),
    rightClicks: pickInteger(item?.rightClicks),
    middleClicks: pickInteger(item?.middleClicks),
    sideBackClicks: pickInteger(item?.sideBackClicks),
    sideForwardClicks: pickInteger(item?.sideForwardClicks),
    scrollTicks: pickInteger(item?.scrollTicks),
    mouseMovePixels: pickInteger(item?.mouseMovePixels),
    keyCounts: normalizeKeyCounts(item?.keyCounts),
  };
}

function normalizeInputActivityWindowStat(item) {
  if (!item || typeof item !== 'object' || typeof item.classificationKey !== 'string') {
    return null;
  }
  const nowIso = new Date().toISOString();
  return {
    classificationKey: item.classificationKey,
    displayName: typeof item.displayName === 'string' ? item.displayName : item.classificationKey,
    objectType: item.objectType === 'BrowserTab' || item.objectType === 'Desktop' ? item.objectType : 'AppWindow',
    processName: typeof item.processName === 'string' ? item.processName : '',
    domain: typeof item.domain === 'string' ? item.domain : undefined,
    ...normalizeInputActivityCounts(item),
    firstAt: typeof item.firstAt === 'string' ? item.firstAt : nowIso,
    lastAt: typeof item.lastAt === 'string' ? item.lastAt : nowIso,
  };
}

function normalizeInputActivityTimelineRecord(item) {
  if (!item || typeof item !== 'object' || typeof item.classificationKey !== 'string') {
    return null;
  }
  const nowMs = Date.now();
  const bucketStartAt =
    typeof item.bucketStartAt === 'string' && item.bucketStartAt
      ? item.bucketStartAt
      : new Date(Math.floor(nowMs / INPUT_ACTIVITY_BUCKET_MS) * INPUT_ACTIVITY_BUCKET_MS).toISOString();
  const bucketStartMs = new Date(bucketStartAt).getTime();
  const safeBucketStartMs = Number.isFinite(bucketStartMs) ? bucketStartMs : nowMs;
  const bucketEndAt =
    typeof item.bucketEndAt === 'string' && item.bucketEndAt
      ? item.bucketEndAt
      : new Date(safeBucketStartMs + INPUT_ACTIVITY_BUCKET_MS).toISOString();

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('input-activity'),
    classificationKey: item.classificationKey,
    displayName: typeof item.displayName === 'string' ? item.displayName : item.classificationKey,
    objectType: item.objectType === 'BrowserTab' || item.objectType === 'Desktop' ? item.objectType : 'AppWindow',
    processName: typeof item.processName === 'string' ? item.processName : '',
    domain: typeof item.domain === 'string' ? item.domain : undefined,
    bucketStartAt,
    bucketEndAt,
    ...normalizeInputActivityCounts(item),
  };
}

function normalizeDiagnosticLog(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const message = typeof item.message === 'string' ? item.message.trim() : '';
  if (!message) {
    return null;
  }
  const level = item.level === 'error' || item.level === 'warn' ? item.level : 'info';
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('log'),
    level,
    message,
    detail: typeof item.detail === 'string' ? item.detail : '',
    occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : new Date().toISOString(),
  };
}

function normalizeSavedState(input) {
  const base = createEmptyState();
  if (!input || typeof input !== 'object') {
    return base;
  }

  const raw = input;
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles
        .filter(item => item && typeof item === 'object' && typeof item.classificationKey === 'string')
        .map(item => ({
          id: typeof item.id === 'string' ? item.id : makeId('profile'),
          classificationKey: item.classificationKey,
          displayName: typeof item.displayName === 'string' ? item.displayName : item.classificationKey,
          objectType: item.objectType === 'BrowserTab' || item.objectType === 'Desktop' ? item.objectType : 'AppWindow',
          processName: typeof item.processName === 'string' ? item.processName : '',
          browserName: typeof item.browserName === 'string' ? item.browserName : undefined,
          normalizedTitle: typeof item.normalizedTitle === 'string' ? item.normalizedTitle : item.classificationKey,
          domain: typeof item.domain === 'string' ? item.domain : undefined,
          category: categoryFromExistingOrDefault(item.category, item.objectType === 'Desktop'),
          isBuiltIn: Boolean(item.isBuiltIn),
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
        }))
    : [];

  const processTags = Array.isArray(raw.processTags) ? raw.processTags : [];
  const processTagAssignments = Array.isArray(raw.processTagAssignments) ? raw.processTagAssignments : [];
  const validTagSet = new Set(processTags.map(tag => tag.id));
  const rawUiState = raw.uiState && typeof raw.uiState === 'object' ? raw.uiState : {};
  const rawMonitoringUi = rawUiState.monitoring && typeof rawUiState.monitoring === 'object'
    ? rawUiState.monitoring
    : {};
  let soundFiles = Array.isArray(raw.soundFiles) ? raw.soundFiles : [];
  const defaultSoundFiles = createDefaultSoundFiles();
  if (soundFiles.length === 0) {
    soundFiles = defaultSoundFiles;
  } else {
    const existingIds = new Set(soundFiles.map(item => item.id));
    for (const builtin of defaultSoundFiles) {
      if (!existingIds.has(builtin.id)) {
        soundFiles.push(builtin);
      }
    }
  }
  const rawPreferences = raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {};

  return {
    ...base,
    ...raw,
    profiles,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    windowStats: Array.isArray(raw.windowStats)
      ? raw.windowStats
          .map(item => normalizeWindowRuntimeStat(item))
          .filter(Boolean)
      : [],
    processTimeline: Array.isArray(raw.processTimeline)
      ? raw.processTimeline
          .map(item => normalizeProcessTimelineRecord(item))
          .filter(Boolean)
          .slice(-MAX_PROCESS_TIMELINE_RECORDS)
      : [],
    inputActivityStats: Array.isArray(raw.inputActivityStats)
      ? raw.inputActivityStats
          .map(item => normalizeInputActivityWindowStat(item))
          .filter(Boolean)
      : [],
    inputActivityTimeline: Array.isArray(raw.inputActivityTimeline)
      ? raw.inputActivityTimeline
          .map(item => normalizeInputActivityTimelineRecord(item))
          .filter(Boolean)
          .slice(-MAX_INPUT_ACTIVITY_TIMELINE_RECORDS)
      : [],
    currentProcessKeys: Array.isArray(raw.currentProcessKeys) ? raw.currentProcessKeys : [],
    currentProcessRuntimeStats: Array.isArray(raw.currentProcessRuntimeStats)
      ? raw.currentProcessRuntimeStats
          .map(item => normalizePendingRuntimeStat(item))
          .filter(Boolean)
      : [],
    processTags,
    processTagAssignments: processTagAssignments.filter(item => validTagSet.has(item.tagId)),
    processTagStats: Array.isArray(raw.processTagStats)
      ? raw.processTagStats
          .map(item => normalizeProcessTagRuntimeStat(item))
          .filter(item => item && validTagSet.has(item.tagId))
      : [],
    soundFiles,
    preferences: {
      recordWindowThresholdSeconds: normalizeRecordWindowThresholdSeconds(
        rawPreferences.recordWindowThresholdSeconds,
        base.preferences.recordWindowThresholdSeconds,
      ),
      analyticsWindowItemLimit: normalizeAnalyticsWindowItemLimit(
        rawPreferences.analyticsWindowItemLimit,
        base.preferences.analyticsWindowItemLimit,
      ),
      uiTheme: normalizeUiTheme(rawPreferences.uiTheme, base.preferences.uiTheme),
      autoLaunchEnabled: normalizeAutoLaunchEnabled(
        rawPreferences.autoLaunchEnabled,
        base.preferences.autoLaunchEnabled,
      ),
      processWhitelist: normalizeProcessWhitelistRules(
        rawPreferences.processWhitelist ?? rawPreferences.urlWhitelist,
        base.preferences.processWhitelist,
      ),
      processBlacklist: normalizeProcessBlacklistRules(
        rawPreferences.processBlacklist,
        base.preferences.processBlacklist,
      ),
      countdownCompletedTaskBehavior: normalizeCountdownCompletedTaskBehavior(
        rawPreferences.countdownCompletedTaskBehavior,
        base.preferences.countdownCompletedTaskBehavior,
      ),
      closeWindowBehavior: normalizeCloseWindowBehavior(
        rawPreferences.closeWindowBehavior,
        base.preferences.closeWindowBehavior,
      ),
    },
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    stopwatchRecords: Array.isArray(raw.stopwatchRecords) ? raw.stopwatchRecords : [],
    countdownTasks: Array.isArray(raw.countdownTasks) ? raw.countdownTasks : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    archives: Array.isArray(raw.archives) ? raw.archives : [],
    powerEvents: Array.isArray(raw.powerEvents) ? raw.powerEvents : [],
    pluginConnections: Array.isArray(raw.pluginConnections) ? raw.pluginConnections : [],
    diagnosticLogs: Array.isArray(raw.diagnosticLogs)
      ? raw.diagnosticLogs
          .map(item => normalizeDiagnosticLog(item))
          .filter(Boolean)
          .slice(-MAX_DIAGNOSTIC_LOGS)
      : [],
    dataDirectoryPath: typeof raw.dataDirectoryPath === 'string' ? raw.dataDirectoryPath : '',
    logFilePath: typeof raw.logFilePath === 'string' ? raw.logFilePath : '',
    currentFocusedWindow: raw.currentFocusedWindow ?? null,
    isWindowHiddenToTray: Boolean(raw.isWindowHiddenToTray),
    displayMode: typeof raw.displayMode === 'string' ? raw.displayMode : DEFAULT_DISPLAY_MODE,
    uiState: {
      ...base.uiState,
      ...rawUiState,
      monitoring: {
        ...base.uiState.monitoring,
        ...rawMonitoringUi,
        historySort: normalizeMonitoringSort(
          rawMonitoringUi.historySort,
          base.uiState.monitoring.historySort,
        ),
        currentSort: normalizeMonitoringSort(
          rawMonitoringUi.currentSort,
          base.uiState.monitoring.currentSort,
        ),
      },
      clock: {
        ...base.uiState.clock,
        ...(rawUiState.clock && typeof rawUiState.clock === 'object' ? rawUiState.clock : {}),
      },
    },
    pomodoroSettings: {
      ...base.pomodoroSettings,
      ...(raw.pomodoroSettings ?? {}),
    },
  };
}

function loadPersistedState() {
  const primaryDataDir = getStatePath();
  ensureDir(primaryDataDir);

  let savedRaw = readStateSections(primaryDataDir);
  const legacyPrimaryRaw = readLegacyJsonState(primaryDataDir);
  if (!savedRaw) {
    savedRaw = legacyPrimaryRaw;
    if (savedRaw) {
      writeStateSections(primaryDataDir, normalizeSavedState(savedRaw));
    }
  }

  if (!savedRaw && !preferredDataDirPath && !app.isPackaged) {
    const fallbackDataDir = path.join(app.getPath('userData'), DEFAULT_STORAGE_DIR_NAME);
    if (fallbackDataDir !== primaryDataDir) {
      const fallbackRaw = readStateSections(fallbackDataDir) || readLegacyJsonState(fallbackDataDir);
      if (fallbackRaw) {
        savedRaw = fallbackRaw;
        writeStateSections(primaryDataDir, normalizeSavedState(fallbackRaw));
      }
    }
  }

  if (!savedRaw && !preferredDataDirPath) {
    const previousDefaultRaw = readJsonSafe(getPreviousDefaultStateFilePath());
    if (previousDefaultRaw) {
      savedRaw = previousDefaultRaw;
      writeStateSections(primaryDataDir, normalizeSavedState(previousDefaultRaw));
    }
  }

  appState = normalizeSavedState(savedRaw);
  closeStaleOpenProcessTimelineRecords();
  syncStorageMetaToState();
  applyWhitelistNamesToState();
}

function applyStatePath(newPath) {
  preferredDataDirPath = newPath;
  resolvedDataDirPath = newPath;
  persistStorageConfig();
  syncStorageMetaToState();
}

function setDataFilePath(targetPath, createIfMissing = false) {
  const normalizedDataDir = resolveDataDirInput(targetPath);
  if (!normalizedDataDir) {
    return { ok: false, error: 'invalid_path' };
  }

  const exists = fs.existsSync(normalizedDataDir);
  if (!exists && !createIfMissing) {
    return { ok: false, requiresCreate: true, path: normalizedDataDir };
  }

  if (!ensureWritableDataDir(normalizedDataDir)) {
    return { ok: false, error: 'path_not_writable', path: normalizedDataDir };
  }

  const loadedRaw = readStateSections(normalizedDataDir) || readLegacyJsonState(normalizedDataDir);

  let nextState = createEmptyState();
  let created = false;
  if (loadedRaw) {
    nextState = normalizeSavedState(loadedRaw);
  } else {
    if (!createIfMissing) {
      return { ok: false, requiresCreate: true, path: normalizedDataDir };
    }
    created = true;
  }

  if (!writeStateSections(normalizedDataDir, nextState)) {
    return { ok: false, error: 'create_failed', path: normalizedDataDir };
  }

  applyStatePath(normalizedDataDir);
  appState = nextState;
  closeStaleOpenProcessTimelineRecords();
  syncStorageMetaToState();
  addDiagnosticLog('info', '数据目录已切换', normalizedDataDir);
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(appState.preferences.autoLaunchEnabled);
  resetRuntimeTrackingState();
  scheduleSave();
  emitState();

  return {
    ok: true,
    path: normalizedDataDir,
    existed: !created,
    created,
    state: appState,
  };
}

function getLegacyJsonStorageStatus(dataDirPath = getStatePath()) {
  const sectionFiles = Object.values(STATE_SECTION_FILES)
    .map(fileName => path.join(dataDirPath, fileName))
    .filter(filePath => fs.existsSync(filePath));
  const legacyStateFile = getLegacyStateFilePath(dataDirPath);
  const hasLegacyStateFile = fs.existsSync(legacyStateFile);
  return {
    hasLegacyJson: hasLegacyStateFile || sectionFiles.length > 0,
    legacyStateFile: hasLegacyStateFile ? legacyStateFile : '',
    sectionFileCount: sectionFiles.length,
  };
}

function getStorageStatus() {
  const dataDirPath = getStatePath();
  const sqliteStatus = getSqliteStateStore(dataDirPath).getStatus();
  return {
    ...sqliteStatus,
    dataDirectoryPath: dataDirPath,
    dbPath: getSqliteStateFilePath(dataDirPath),
    legacy: getLegacyJsonStorageStatus(dataDirPath),
  };
}

function migrateLegacyJsonStorageToSqlite() {
  const dataDirPath = getStatePath();
  const legacyRaw = readLegacyJsonState(dataDirPath);
  if (!legacyRaw) {
    return {
      ok: false,
      error: 'no_legacy_json',
      status: getStorageStatus(),
    };
  }

  const nextState = normalizeSavedState(legacyRaw);
  if (!writeStateSections(dataDirPath, nextState)) {
    return {
      ok: false,
      error: 'write_failed',
      status: getStorageStatus(),
    };
  }

  appState = nextState;
  closeStaleOpenProcessTimelineRecords();
  syncStorageMetaToState();
  applyWhitelistNamesToState();
  addDiagnosticLog('info', 'Legacy JSON storage migrated to SQLite', getSqliteStateFilePath(dataDirPath));
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(appState.preferences.autoLaunchEnabled);
  resetRuntimeTrackingState();
  scheduleSave();
  emitState();

  return {
    ok: true,
    state: appState,
    status: getStorageStatus(),
  };
}

function resetRuntimeTrackingState() {
  monitorCursor.lastTickAtMs = null;
  monitorCursor.carryMs = 0;
  monitorCursor.activeSessionId = null;
  monitorCursor.activeClassificationKey = null;
  monitorCursor.activeTagId = null;
  monitorCursor.tagFocusStreakSeconds = 0;
  pendingWindowRuntime.clear();
  recentlyClosedWindowRuntime.clear();
  inputHookRuntime.lastMousePoint = null;
  inputHookRuntime.lastMouseMoveAtMs = 0;
  appState.currentProcessRuntimeStats = [];
  browserBridgeState.byBrowser.clear();
  pluginBridgeState.byPlugin.clear();
  codeWindowIdentityCache.clear();
  syncPluginConnectionsToState([]);
}

function clearAllData() {
  appState = createEmptyState();
  try {
    getSqliteStateStore(getStatePath()).clearClipboardHistory();
  } catch (error) {
    addDiagnosticLog('warn', 'Failed to clear clipboard history', error?.message || String(error));
  }
  syncStorageMetaToState();
  addDiagnosticLog('warn', '用户执行清空所有数据');
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(false);
  resetRuntimeTrackingState();
  scheduleSave();
  emitState();
  return appState;
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('monitor:state', appState);
}

function normalizeProcessName(ownerPath, ownerName) {
  const fromPath = typeof ownerPath === 'string' ? path.basename(ownerPath) : '';
  if (fromPath) {
    return fromPath.toLowerCase();
  }
  if (typeof ownerName === 'string' && ownerName.trim()) {
    return ownerName.trim().toLowerCase();
  }
  return 'unknown';
}

function pruneCodeWindowIdentityCache(nowMs = Date.now()) {
  for (const [cacheKey, cacheValue] of codeWindowIdentityCache.entries()) {
    if (nowMs - cacheValue.updatedAtMs > CODE_WINDOW_CACHE_MAX_AGE_MS) {
      codeWindowIdentityCache.delete(cacheKey);
    }
  }
}

function getCodeWindowCacheKey(processName, windowId) {
  if (!VS_CODE_PROCESS_NAMES.has(processName)) {
    return null;
  }
  if (windowId === undefined || windowId === null) {
    return null;
  }
  return `${processName}|${String(windowId)}`;
}

function looksLikeFileNameSegment(segment) {
  const value = (segment || '').trim();
  if (!value) {
    return false;
  }
  if (value.includes('/') || value.includes('\\')) {
    return false;
  }
  return /^[^<>:"/\\|?*]+\.[A-Za-z0-9]{1,12}$/.test(value);
}

function getVsCodeSoftwareLabel(title) {
  const value = (title || '').trim();
  const matched = value.match(/visual studio code(?:\s*-\s*insiders)?/i);
  if (!matched) {
    return 'Visual Studio Code';
  }
  const normalized = matched[0].replace(/\s+/g, ' ').trim();
  return /insiders/i.test(normalized)
    ? 'Visual Studio Code - Insiders'
    : 'Visual Studio Code';
}

function extractVsCodeProjectName(title) {
  const value = (title || '').trim();
  if (!value) {
    return null;
  }

  const parts = value
    .split(' - ')
    .map(item => item.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  let softwareIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (/visual studio code/i.test(parts[index])) {
      softwareIndex = index;
      break;
    }
  }

  let candidates = softwareIndex >= 0 ? parts.slice(0, softwareIndex) : [...parts];
  if (candidates.length > 1 && looksLikeFileNameSegment(candidates[0])) {
    candidates = candidates.slice(1);
  }
  if (candidates.length === 0) {
    return null;
  }

  // Prefer the longest non-empty segment, which is usually workspace/project name.
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.length > best.length) {
      best = candidate;
    }
  }
  const normalized = best.trim();
  return normalized || null;
}

function getVsCodeIdentity(rawWindow, processName, title) {
  const nowMs = Date.now();
  const cacheKey = getCodeWindowCacheKey(processName, rawWindow?.id);
  const softwareLabel = getVsCodeSoftwareLabel(title);
  const projectName = extractVsCodeProjectName(title);

  if (!projectName && cacheKey) {
    const cached = codeWindowIdentityCache.get(cacheKey);
    if (cached) {
      cached.updatedAtMs = nowMs;
      return cached.identity;
    }
  }

  const displayName = projectName ? `${projectName} - ${softwareLabel}` : softwareLabel;
  const identity = {
    classificationKey: ['AppWindow', processName, displayName.toLowerCase()].join('|').slice(0, 300),
    displayName,
    normalizedTitle: displayName,
  };

  if (cacheKey) {
    codeWindowIdentityCache.set(cacheKey, {
      identity,
      updatedAtMs: nowMs,
    });
  }
  return identity;
}

function isDesktopWindow(processName, title) {
  const lowerTitle = (title || '').trim().toLowerCase();
  return (
    processName === 'explorer.exe' &&
    (!lowerTitle || lowerTitle === 'program manager' || lowerTitle === 'workerw')
  );
}

function getBridgeSnapshotForProcess(processName) {
  const browserId = BROWSER_PROCESS_TO_ID[processName.toLowerCase()];
  if (!browserId) {
    return null;
  }
  const snapshot = browserBridgeState.byBrowser.get(browserId);
  if (!snapshot) {
    return null;
  }
  if (Date.now() - snapshot.updatedAtMs > BROWSER_BRIDGE_STALE_MS) {
    return null;
  }
  return snapshot;
}

function toDomainProfile(domain, processName = 'browser', normalizedTitle = undefined) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return null;
  }

  return {
    id: makeId('profile'),
    classificationKey: `${BROWSER_DOMAIN_KEY_PREFIX}|${normalized}`,
    displayName: normalized,
    objectType: 'BrowserTab',
    processName,
    normalizedTitle:
      typeof normalizedTitle === 'string' && normalizedTitle.trim()
        ? normalizedTitle.trim()
        : normalized,
    domain: normalized,
    category: DEFAULT_CATEGORY,
    isBuiltIn: false,
    updatedAt: new Date().toISOString(),
  };
}

function toProcessWhitelistProfile(rule, sourceProfile) {
  if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !sourceProfile) {
    return null;
  }
  const fallbackName = rule.namePattern || rule.typePattern || rule.processPattern || sourceProfile.displayName;
  const displayName = normalizeWhitelistName(rule.name, fallbackName);

  return {
    ...sourceProfile,
    id: makeId('profile'),
    classificationKey: `${PROCESS_WHITELIST_KEY_PREFIX}|${rule.id}`.slice(0, 300),
    displayName,
    normalizedTitle: displayName,
    category: DEFAULT_CATEGORY,
    updatedAt: new Date().toISOString(),
  };
}

function applyProcessWhitelistToProfile(profile) {
  const matchedRules = findMatchingProcessWhitelistRules(profile);
  if (matchedRules.length === 0) {
    return [profile];
  }
  return matchedRules
    .map(rule => toProcessWhitelistProfile(rule, profile))
    .filter(Boolean);
}

function toNonBrowserProfile(rawWindow) {
  const processName = normalizeProcessName(rawWindow.owner?.path, rawWindow.owner?.name);
  const title = (rawWindow.title || '').trim();

  if (isDesktopWindow(processName, title)) {
    return {
      id: makeId('profile'),
      classificationKey: DESKTOP_KEY,
      displayName: '桌面',
      objectType: 'Desktop',
      processName: 'explorer.exe',
      normalizedTitle: '桌面',
      category: DESKTOP_CATEGORY,
      isBuiltIn: true,
      updatedAt: new Date().toISOString(),
    };
  }

  if (BROWSER_PROCESS_NAMES.has(processName)) {
    return null;
  }

  let normalizedTitle = title || processName;
  let displayName = normalizedTitle;
  let classificationKey = ['AppWindow', processName, normalizedTitle.toLowerCase()].filter(Boolean).join('|').slice(0, 300);

  if (VS_CODE_PROCESS_NAMES.has(processName)) {
    const identity = getVsCodeIdentity(rawWindow, processName, title);
    normalizedTitle = identity.normalizedTitle;
    displayName = identity.displayName;
    classificationKey = identity.classificationKey;
  }

  return {
    id: makeId('profile'),
    classificationKey,
    displayName,
    objectType: 'AppWindow',
    processName,
    normalizedTitle,
    category: DEFAULT_CATEGORY,
    isBuiltIn: false,
    updatedAt: new Date().toISOString(),
  };
}

function toFocusedWindowProfile(rawWindow) {
  if (!rawWindow) {
    return {
      id: makeId('profile'),
      classificationKey: DESKTOP_KEY,
      displayName: '桌面',
      objectType: 'Desktop',
      processName: 'explorer.exe',
      normalizedTitle: '桌面',
      category: DESKTOP_CATEGORY,
      isBuiltIn: true,
      updatedAt: new Date().toISOString(),
    };
  }

  const processName = normalizeProcessName(rawWindow.owner?.path, rawWindow.owner?.name);
  const title = (rawWindow.title || '').trim();

  if (isDesktopWindow(processName, title)) {
    return {
      id: makeId('profile'),
      classificationKey: DESKTOP_KEY,
      displayName: '桌面',
      objectType: 'Desktop',
      processName: 'explorer.exe',
      normalizedTitle: '桌面',
      category: DESKTOP_CATEGORY,
      isBuiltIn: true,
      updatedAt: new Date().toISOString(),
    };
  }

  if (BROWSER_PROCESS_NAMES.has(processName)) {
    const bridgeSnapshot = getBridgeSnapshotForProcess(processName);
    const bridgeActiveUrl = normalizeWebUrl(bridgeSnapshot?.activeUrl);
    const activeWinUrl = normalizeWebUrl(rawWindow.url);
    const activeUrl = bridgeActiveUrl || activeWinUrl;

    const bridgeDomain = bridgeSnapshot?.activeDomain || null;
    const activeUrlDomain = activeUrl ? safeParseDomainFromUrl(activeUrl) : null;
    const activeWinDomain = safeParseDomainFromUrl(rawWindow.url);
    const domain = bridgeDomain || activeUrlDomain || activeWinDomain;
    if (!domain) {
      // Ignore browser title noise; only use domain-based browser record.
      return null;
    }
    return {
      id: makeId('profile'),
      classificationKey: `${BROWSER_DOMAIN_KEY_PREFIX}|${domain}`,
      displayName: domain,
      objectType: 'BrowserTab',
      processName,
      browserName: rawWindow.owner?.name || undefined,
      normalizedTitle: activeUrl || domain,
      domain,
      category: DEFAULT_CATEGORY,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const fallbackProfile = toNonBrowserProfile(rawWindow);
  if (!fallbackProfile) {
    return null;
  }
  return fallbackProfile;
}

function ensureProfile(profileCandidate) {
  const existing = appState.profiles.find(item => item.classificationKey === profileCandidate.classificationKey);
  if (existing) {
    const merged = {
      ...existing,
      displayName: profileCandidate.displayName,
      objectType: profileCandidate.objectType,
      processName: profileCandidate.processName,
      browserName: profileCandidate.browserName,
      normalizedTitle: profileCandidate.normalizedTitle,
      domain: profileCandidate.domain,
      updatedAt: profileCandidate.updatedAt,
    };
    appState.profiles = appState.profiles.map(item => (item.classificationKey === merged.classificationKey ? merged : item));
    return merged;
  }

  const toInsert = {
    ...profileCandidate,
    category: categoryFromExistingOrDefault(profileCandidate.category, profileCandidate.objectType === 'Desktop'),
  };
  appState.profiles = [...appState.profiles, toInsert];
  return toInsert;
}

function upsertWindowStat(profile, deltaSeconds, focusDeltaSeconds, options = {}) {
  const nextLastFocusAt = typeof options.lastFocusAt === 'string' ? options.lastFocusAt : undefined;
  const nextLongestContinuousFocusSeconds = Number.isFinite(Number(options.longestContinuousFocusSeconds))
    ? Math.max(0, Math.floor(Number(options.longestContinuousFocusSeconds)))
    : 0;
  const existing = appState.windowStats.find(item => item.classificationKey === profile.classificationKey);
  if (existing) {
    existing.displayName = profile.displayName;
    existing.objectType = profile.objectType;
    existing.processName = profile.processName;
    existing.domain = profile.domain;
    existing.category = profile.category;
    existing.totalVisibleSeconds += deltaSeconds;
    existing.focusSeconds += focusDeltaSeconds;
    if (nextLastFocusAt) {
      existing.lastFocusAt = nextLastFocusAt;
    }
    existing.longestContinuousFocusSeconds = Math.max(
      Number(existing.longestContinuousFocusSeconds) || 0,
      nextLongestContinuousFocusSeconds,
    );
    return;
  }

  appState.windowStats.push({
    classificationKey: profile.classificationKey,
    displayName: profile.displayName,
    objectType: profile.objectType,
    processName: profile.processName,
    domain: profile.domain,
    category: profile.category,
    totalVisibleSeconds: deltaSeconds,
    focusSeconds: focusDeltaSeconds,
    lastFocusAt: nextLastFocusAt || '',
    longestContinuousFocusSeconds: nextLongestContinuousFocusSeconds,
  });
}

function upsertProcessTimeline(profile, pending, nowIso) {
  const timelineStartAt =
    typeof pending.firstSeenAt === 'string' && pending.firstSeenAt
      ? pending.firstSeenAt
      : nowIso;
  const timelineId =
    typeof pending.processTimelineId === 'string' && pending.processTimelineId
      ? pending.processTimelineId
      : makeId('process-timeline');
  const existing = (appState.processTimeline || []).find(item => item.id === timelineId);
  const durationSeconds = Math.max(
    0,
    Number.isFinite(Number(pending.totalVisibleSeconds))
      ? Math.floor(Number(pending.totalVisibleSeconds))
      : Math.floor((new Date(nowIso).getTime() - new Date(timelineStartAt).getTime()) / 1000),
  );

  if (existing) {
    existing.displayName = profile.displayName;
    existing.objectType = profile.objectType;
    existing.processName = profile.processName;
    existing.domain = profile.domain;
    existing.categoryAtThatTime = profile.category;
    existing.endAt = nowIso;
    existing.durationSeconds = durationSeconds;
    existing.isOpen = true;
    pending.processTimelineId = existing.id;
    return existing.id;
  }

  appState.processTimeline = [
    ...(appState.processTimeline || []),
    {
      id: timelineId,
      classificationKey: profile.classificationKey,
      displayName: profile.displayName,
      objectType: profile.objectType,
      processName: profile.processName,
      domain: profile.domain,
      categoryAtThatTime: profile.category,
      startAt: timelineStartAt,
      endAt: nowIso,
      durationSeconds,
      isOpen: true,
    },
  ];

  if (appState.processTimeline.length > MAX_PROCESS_TIMELINE_RECORDS) {
    appState.processTimeline = appState.processTimeline.slice(-MAX_PROCESS_TIMELINE_RECORDS);
  }

  pending.processTimelineId = timelineId;
  return timelineId;
}

function finalizeProcessTimeline(pending, nowIso) {
  const timelineId = pending?.processTimelineId;
  if (!timelineId || !Array.isArray(appState.processTimeline)) {
    return;
  }
  appState.processTimeline = appState.processTimeline.map(item => {
    if (item.id !== timelineId) {
      return item;
    }
    const endAt = nowIso;
    return {
      ...item,
      endAt,
      durationSeconds: Math.max(
        Number(item.durationSeconds) || 0,
        Math.floor((new Date(endAt).getTime() - new Date(item.startAt).getTime()) / 1000),
      ),
      isOpen: false,
    };
  });
}

function finalizeAllOpenProcessTimelines(nowIso = new Date().toISOString()) {
  for (const pending of pendingWindowRuntime.values()) {
    finalizeProcessTimeline(pending, nowIso);
  }
}

function createInputActivityCounts() {
  return {
    keyPresses: 0,
    leftClicks: 0,
    rightClicks: 0,
    middleClicks: 0,
    sideBackClicks: 0,
    sideForwardClicks: 0,
    scrollTicks: 0,
    mouseMovePixels: 0,
    keyCounts: {},
  };
}

function hasInputActivityCounts(counts) {
  if (!counts || typeof counts !== 'object') {
    return false;
  }
  const normalized = normalizeInputActivityCounts(counts);
  return (
    normalized.keyPresses > 0 ||
    normalized.leftClicks > 0 ||
    normalized.rightClicks > 0 ||
    normalized.middleClicks > 0 ||
    normalized.sideBackClicks > 0 ||
    normalized.sideForwardClicks > 0 ||
    normalized.scrollTicks > 0 ||
    normalized.mouseMovePixels > 0 ||
    Object.values(normalized.keyCounts).some(value => value > 0)
  );
}

function mergeInputActivityCounts(target, incoming) {
  const normalizedTarget = normalizeInputActivityCounts(target);
  const normalizedIncoming = normalizeInputActivityCounts(incoming);
  for (const key of Object.keys(normalizedIncoming)) {
    if (key === 'keyCounts') {
      continue;
    }
    normalizedTarget[key] = (Number(normalizedTarget[key]) || 0) + (Number(normalizedIncoming[key]) || 0);
  }
  for (const [keycode, count] of Object.entries(normalizedIncoming.keyCounts)) {
    normalizedTarget.keyCounts[keycode] =
      (Number(normalizedTarget.keyCounts[keycode]) || 0) + (Number(count) || 0);
  }
  return normalizedTarget;
}

function getInputActivityBucketStartMs(timeMs) {
  const normalizedTime = Number.isFinite(Number(timeMs)) ? Number(timeMs) : Date.now();
  return Math.floor(normalizedTime / INPUT_ACTIVITY_BUCKET_MS) * INPUT_ACTIVITY_BUCKET_MS;
}

function upsertInputActivityRecords(profile, counts, occurredAtIso = new Date().toISOString()) {
  if (!profile || !profile.classificationKey || !hasInputActivityCounts(counts)) {
    return;
  }

  const normalizedCounts = normalizeInputActivityCounts(counts);
  const occurredAtMs = new Date(occurredAtIso).getTime();
  const safeOccurredAtIso = Number.isFinite(occurredAtMs) ? occurredAtIso : new Date().toISOString();
  const bucketStartMs = getInputActivityBucketStartMs(Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now());
  const bucketStartAt = new Date(bucketStartMs).toISOString();
  const bucketEndAt = new Date(bucketStartMs + INPUT_ACTIVITY_BUCKET_MS).toISOString();

  const existingStat = (appState.inputActivityStats || []).find(
    item => item.classificationKey === profile.classificationKey,
  );
  if (existingStat) {
    existingStat.displayName = profile.displayName;
    existingStat.objectType = profile.objectType;
    existingStat.processName = profile.processName;
    existingStat.domain = profile.domain;
    const merged = mergeInputActivityCounts(existingStat, normalizedCounts);
    Object.assign(existingStat, merged);
    existingStat.firstAt =
      existingStat.firstAt && new Date(existingStat.firstAt).getTime() < new Date(safeOccurredAtIso).getTime()
        ? existingStat.firstAt
        : safeOccurredAtIso;
    existingStat.lastAt = safeOccurredAtIso;
  } else {
    appState.inputActivityStats = [
      ...(appState.inputActivityStats || []),
      {
        classificationKey: profile.classificationKey,
        displayName: profile.displayName,
        objectType: profile.objectType,
        processName: profile.processName,
        domain: profile.domain,
        ...normalizedCounts,
        firstAt: safeOccurredAtIso,
        lastAt: safeOccurredAtIso,
      },
    ];
  }

  const bucketId = `input-activity|${profile.classificationKey}|${bucketStartMs}`;
  const existingBucket = (appState.inputActivityTimeline || []).find(item => item.id === bucketId);
  if (existingBucket) {
    existingBucket.displayName = profile.displayName;
    existingBucket.objectType = profile.objectType;
    existingBucket.processName = profile.processName;
    existingBucket.domain = profile.domain;
    const merged = mergeInputActivityCounts(existingBucket, normalizedCounts);
    Object.assign(existingBucket, merged);
  } else {
    appState.inputActivityTimeline = [
      ...(appState.inputActivityTimeline || []),
      {
        id: bucketId,
        classificationKey: profile.classificationKey,
        displayName: profile.displayName,
        objectType: profile.objectType,
        processName: profile.processName,
        domain: profile.domain,
        bucketStartAt,
        bucketEndAt,
        ...normalizedCounts,
      },
    ];

    if (appState.inputActivityTimeline.length > MAX_INPUT_ACTIVITY_TIMELINE_RECORDS) {
      appState.inputActivityTimeline = appState.inputActivityTimeline.slice(-MAX_INPUT_ACTIVITY_TIMELINE_RECORDS);
    }
  }

  scheduleInputActivityFlush();
}

function scheduleInputActivityFlush() {
  if (inputActivityFlushTimer) {
    return;
  }
  inputActivityFlushTimer = setTimeout(() => {
    inputActivityFlushTimer = null;
    scheduleSave();
    emitState();
  }, INPUT_ACTIVITY_FLUSH_DELAY_MS);
}

function cachePendingInputActivity(profile, counts, occurredAtIso) {
  const pending = pendingWindowRuntime.get(profile.classificationKey);
  if (!pending || pending.recorded) {
    return false;
  }
  pending.inputActivityCounts = mergeInputActivityCounts(pending.inputActivityCounts, counts);
  if (!pending.inputActivityFirstAt) {
    pending.inputActivityFirstAt = occurredAtIso;
  }
  pending.inputActivityLastAt = occurredAtIso;
  return true;
}

function flushPendingInputActivity(profile, pending, fallbackIso = new Date().toISOString()) {
  if (!pending || !hasInputActivityCounts(pending.inputActivityCounts)) {
    return;
  }
  const occurredAtIso =
    typeof pending.inputActivityLastAt === 'string' && pending.inputActivityLastAt
      ? pending.inputActivityLastAt
      : fallbackIso;
  upsertInputActivityRecords(profile, pending.inputActivityCounts, occurredAtIso);
  pending.inputActivityCounts = createInputActivityCounts();
  pending.inputActivityFirstAt = undefined;
  pending.inputActivityLastAt = undefined;
}

function recordInputActivityForFocusedWindow(counts, occurredAtMs = Date.now()) {
  if (!hasInputActivityCounts(counts)) {
    return;
  }
  const profile = appState.currentFocusedWindow;
  if (!profile || !profile.classificationKey) {
    return;
  }

  const occurredAtIso = new Date(occurredAtMs).toISOString();
  const pending = pendingWindowRuntime.get(profile.classificationKey);
  if (cachePendingInputActivity(profile, counts, occurredAtIso)) {
    return;
  }
  const hasRecordedWindow = (appState.windowStats || []).some(
    item => item.classificationKey === profile.classificationKey,
  );
  if (!pending && !hasRecordedWindow) {
    return;
  }
  upsertInputActivityRecords(profile, counts, occurredAtIso);
}

function getMouseButtonCountPatch(buttonValue) {
  const counts = createInputActivityCounts();
  const button = Number(buttonValue);
  if (button === 2) {
    counts.rightClicks = 1;
  } else if (button === 3) {
    counts.middleClicks = 1;
  } else if (button === 4) {
    counts.sideBackClicks = 1;
  } else if (button === 5) {
    counts.sideForwardClicks = 1;
  } else {
    counts.leftClicks = 1;
  }
  return counts;
}

function normalizeWheelTicks(event) {
  const candidates = [event?.amount, event?.rotation, event?.clicks];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed !== 0) {
      return Math.max(1, Math.round(Math.abs(parsed)));
    }
  }
  return 1;
}

function getInputEventTimeMs(event) {
  const nowMs = Date.now();
  const parsed = Number(event?.time);
  if (
    Number.isFinite(parsed) &&
    parsed > nowMs - 7 * 24 * 3600000 &&
    parsed < nowMs + 24 * 3600000
  ) {
    return parsed;
  }
  return nowMs;
}

function handleInputKeyDown(event) {
  const counts = createInputActivityCounts();
  counts.keyPresses = 1;
  const keycode = Number(event?.keycode);
  if (Number.isFinite(keycode) && keycode > 0) {
    counts.keyCounts[String(Math.floor(keycode))] = 1;
  }
  recordInputActivityForFocusedWindow(counts, getInputEventTimeMs(event));
}

function handleInputMouseDown(event) {
  recordInputActivityForFocusedWindow(getMouseButtonCountPatch(event?.button), getInputEventTimeMs(event));
}

function handleInputWheel(event) {
  const counts = createInputActivityCounts();
  counts.scrollTicks = normalizeWheelTicks(event);
  recordInputActivityForFocusedWindow(counts, getInputEventTimeMs(event));
}

function handleInputMouseMove(event) {
  const x = Number(event?.x);
  const y = Number(event?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const nowMs = getInputEventTimeMs(event);
  const lastPoint = inputHookRuntime.lastMousePoint;
  if (!lastPoint) {
    inputHookRuntime.lastMousePoint = { x, y };
    inputHookRuntime.lastMouseMoveAtMs = nowMs;
    return;
  }
  if (nowMs - inputHookRuntime.lastMouseMoveAtMs < MOUSE_MOVE_SAMPLE_MS) {
    return;
  }
  const distance = Math.hypot(x - lastPoint.x, y - lastPoint.y);
  inputHookRuntime.lastMousePoint = { x, y };
  inputHookRuntime.lastMouseMoveAtMs = nowMs;
  if (!Number.isFinite(distance) || distance <= 0 || distance > MOUSE_MOVE_MAX_DELTA_PIXELS) {
    return;
  }
  const counts = createInputActivityCounts();
  counts.mouseMovePixels = Math.round(distance);
  recordInputActivityForFocusedWindow(counts, nowMs);
}

function loadInputHookApi() {
  if (inputHookApi) {
    return inputHookApi;
  }
  try {
    const hookModule = require('uiohook-napi');
    inputHookApi = hookModule?.uIOhook || null;
  } catch (error) {
    addDiagnosticLog('warn', '键鼠统计监听加载失败', error?.message || String(error));
    inputHookApi = null;
  }
  return inputHookApi;
}

function startInputActivityMonitoring() {
  if (inputHookStarted) {
    return;
  }
  const hook = loadInputHookApi();
  if (!hook || typeof hook.on !== 'function' || typeof hook.start !== 'function') {
    addDiagnosticLog('warn', '键鼠统计监听不可用', '未找到 uiohook-napi 运行时');
    return;
  }

  try {
    hook.on('keydown', handleInputKeyDown);
    hook.on('mousedown', handleInputMouseDown);
    hook.on('wheel', handleInputWheel);
    hook.on('mousemove', handleInputMouseMove);
    hook.start();
    inputHookStarted = true;
    addDiagnosticLog('info', '键鼠统计监听已启动', '仅记录按键次数、点击次数、滚动量和鼠标移动距离');
  } catch (error) {
    inputHookStarted = false;
    addDiagnosticLog('error', '键鼠统计监听启动失败', error?.message || String(error));
  }
}

function stopInputActivityMonitoring() {
  if (!inputHookApi || !inputHookStarted) {
    return;
  }
  try {
    inputHookApi.stop();
    if (typeof inputHookApi.removeListener === 'function') {
      inputHookApi.removeListener('keydown', handleInputKeyDown);
      inputHookApi.removeListener('mousedown', handleInputMouseDown);
      inputHookApi.removeListener('wheel', handleInputWheel);
      inputHookApi.removeListener('mousemove', handleInputMouseMove);
    }
  } catch (error) {
    addDiagnosticLog('warn', '键鼠统计监听停止失败', error?.message || String(error));
  } finally {
    inputHookStarted = false;
    inputHookRuntime.lastMousePoint = null;
    inputHookRuntime.lastMouseMoveAtMs = 0;
  }
}

function getFreshBridgeOpenProfiles() {
  const nowMs = Date.now();
  const candidateMap = new Map();

  for (const [browserId, snapshot] of browserBridgeState.byBrowser.entries()) {
    if (nowMs - snapshot.updatedAtMs > BROWSER_BRIDGE_STALE_MS) {
      continue;
    }

    const processName = `${browserId}.exe`;
    const hasOpenUrls = Array.isArray(snapshot.openUrls) && snapshot.openUrls.length > 0;

    if (hasOpenUrls) {
      for (const openUrl of snapshot.openUrls) {
        if (!openUrl) {
          continue;
        }

        const domainProfile = toDomainProfile(
          safeParseDomainFromUrl(openUrl),
          processName,
          openUrl,
        );
        if (domainProfile) {
          candidateMap.set(domainProfile.classificationKey, domainProfile);
        }
      }
      continue;
    }

    for (const domain of snapshot.openDomains) {
      const domainProfile = toDomainProfile(domain, processName);
      if (domainProfile) {
        candidateMap.set(domainProfile.classificationKey, domainProfile);
      }
    }
  }

  return [...candidateMap.values()];
}

function collectPluginSuppressRules(activeSnapshots) {
  const rules = [];
  for (const snapshot of activeSnapshots) {
    if (!snapshot || !Array.isArray(snapshot.suppressRules)) {
      continue;
    }
    rules.push(...snapshot.suppressRules);
  }
  return rules;
}

function shouldSuppressByPluginRules(profile, suppressRules) {
  if (!profile || !Array.isArray(suppressRules) || suppressRules.length === 0) {
    return false;
  }
  return suppressRules.some(rule => matchesProcessRule(rule, profile));
}

function getFreshPluginProfiles(activeSnapshots) {
  const candidateMap = new Map();
  for (const snapshot of activeSnapshots) {
    for (const record of snapshot.records || []) {
      if (!record || typeof record.classificationKey !== 'string') {
        continue;
      }
      candidateMap.set(record.classificationKey, {
        ...record,
        id: makeId('profile'),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return [...candidateMap.values()];
}

function getProcessTagAssignmentMap() {
  const validTagSet = new Set(appState.processTags.map(tag => tag.id));
  const assignmentMap = new Map();
  for (const assignment of appState.processTagAssignments) {
    if (!validTagSet.has(assignment.tagId)) {
      continue;
    }
    assignmentMap.set(assignment.classificationKey, assignment);
  }
  return assignmentMap;
}

function updateProcessTagStats(visibleDeltasByKey, focusDeltasByKey, nowIso, focusedTagStreakSeconds = 0) {
  if (!(visibleDeltasByKey instanceof Map) || !(focusDeltasByKey instanceof Map)) {
    return;
  }

  const assignmentMap = getProcessTagAssignmentMap();
  const visibleDeltaByTag = new Map();
  const focusDeltaByTag = new Map();

  for (const [classificationKey, visibleDelta] of visibleDeltasByKey.entries()) {
    const assignment = assignmentMap.get(classificationKey);
    const normalizedDelta = Number.isFinite(Number(visibleDelta))
      ? Math.max(0, Math.floor(Number(visibleDelta)))
      : 0;
    if (!assignment || normalizedDelta <= 0) {
      continue;
    }
    visibleDeltaByTag.set(
      assignment.tagId,
      (visibleDeltaByTag.get(assignment.tagId) || 0) + normalizedDelta,
    );
  }

  for (const [classificationKey, focusDelta] of focusDeltasByKey.entries()) {
    const assignment = assignmentMap.get(classificationKey);
    const normalizedDelta = Number.isFinite(Number(focusDelta))
      ? Math.max(0, Math.floor(Number(focusDelta)))
      : 0;
    if (!assignment || normalizedDelta <= 0) {
      continue;
    }
    focusDeltaByTag.set(
      assignment.tagId,
      (focusDeltaByTag.get(assignment.tagId) || 0) + normalizedDelta,
    );
  }

  const statMap = new Map(appState.processTagStats.map(item => [item.tagId, item]));

  for (const [tagId, visibleDelta] of visibleDeltaByTag.entries()) {
    const existing = statMap.get(tagId);
    if (existing) {
      existing.totalVisibleSeconds += visibleDelta;
    } else {
      statMap.set(tagId, {
        tagId,
        totalVisibleSeconds: visibleDelta,
        focusSeconds: 0,
        lastFocusAt: '',
        longestContinuousFocusSeconds: 0,
      });
    }
  }

  for (const [focusedTagId, focusDelta] of focusDeltaByTag.entries()) {
    const focusedStat = statMap.get(focusedTagId);
    if (focusedStat) {
      focusedStat.focusSeconds += focusDelta;
      focusedStat.lastFocusAt = nowIso;
      focusedStat.longestContinuousFocusSeconds = Math.max(
        Number(focusedStat.longestContinuousFocusSeconds) || 0,
        Math.max(0, Math.floor(Number(focusedTagStreakSeconds) || 0)),
      );
    } else {
      statMap.set(focusedTagId, {
        tagId: focusedTagId,
        totalVisibleSeconds: 0,
        focusSeconds: deltaSeconds,
        lastFocusAt: nowIso,
        longestContinuousFocusSeconds: Math.max(0, Math.floor(Number(focusedTagStreakSeconds) || 0)),
      });
    }
  }

  const validTagSet = new Set(appState.processTags.map(tag => tag.id));
  appState.processTagStats = [...statMap.values()].filter(item => validTagSet.has(item.tagId));
}

function syncCurrentProcessRuntimeStats() {
  const runtimeStats = [];
  for (const [classificationKey, pending] of pendingWindowRuntime.entries()) {
    if (!pending || typeof pending !== 'object') {
      continue;
    }
    runtimeStats.push({
      classificationKey,
      firstSeenAt: typeof pending.firstSeenAt === 'string' ? pending.firstSeenAt : '',
      totalVisibleSeconds: Number.isFinite(Number(pending.totalVisibleSeconds))
        ? Math.max(0, Math.floor(Number(pending.totalVisibleSeconds)))
        : 0,
      totalFocusSeconds: Number.isFinite(Number(pending.totalFocusSeconds))
        ? Math.max(0, Math.floor(Number(pending.totalFocusSeconds)))
        : 0,
      currentContinuousFocusSeconds: Number.isFinite(Number(pending.currentContinuousFocusSeconds))
        ? Math.max(0, Math.floor(Number(pending.currentContinuousFocusSeconds)))
        : 0,
      longestContinuousFocusSeconds: Number.isFinite(Number(pending.longestContinuousFocusSeconds))
        ? Math.max(0, Math.floor(Number(pending.longestContinuousFocusSeconds)))
        : 0,
      lastFocusAt: typeof pending.lastFocusAt === 'string' ? pending.lastFocusAt : '',
      recorded: Boolean(pending.recorded),
      processTimelineId: typeof pending.processTimelineId === 'string' ? pending.processTimelineId : undefined,
      focusSegmentStartedAt:
        typeof pending.focusSegmentStartedAt === 'string' ? pending.focusSegmentStartedAt : undefined,
      focusSegmentRecordedSeconds: Number.isFinite(Number(pending.focusSegmentRecordedSeconds))
        ? Math.max(0, Math.floor(Number(pending.focusSegmentRecordedSeconds)))
        : 0,
    });
  }
  appState.currentProcessRuntimeStats = runtimeStats;
}

function upsertActiveSession(profile, nowIso, options = {}) {
  const sessionStartAt =
    typeof options.startAt === 'string' && options.startAt
      ? options.startAt
      : nowIso;
  const durationDeltaSeconds = Number.isFinite(Number(options.durationDeltaSeconds))
    ? Math.max(0, Math.floor(Number(options.durationDeltaSeconds)))
    : undefined;
  const mergeGapSeconds = Number.isFinite(Number(options.mergeGapSeconds))
    ? Math.max(0, Math.floor(Number(options.mergeGapSeconds)))
    : 0;
  if (monitorCursor.activeSessionId && monitorCursor.activeClassificationKey === profile.classificationKey) {
    const activeSession = appState.sessions.find(session => session.id === monitorCursor.activeSessionId);
    if (activeSession) {
      const sessionStartMs = new Date(sessionStartAt).getTime();
      const lastEndMs = new Date(activeSession.endAt).getTime();
      const shouldContinueSession =
        !Number.isFinite(sessionStartMs) ||
        !Number.isFinite(lastEndMs) ||
        Math.max(0, Math.floor((sessionStartMs - lastEndMs) / 1000)) <= mergeGapSeconds;

      if (shouldContinueSession) {
        appState.sessions = appState.sessions.map(session => {
          if (session.id !== monitorCursor.activeSessionId) {
            return session;
          }
          const durationSeconds = Math.max(
            1,
            Math.floor((new Date(nowIso).getTime() - new Date(session.startAt).getTime()) / 1000),
          );
          return {
            ...session,
            endAt: nowIso,
            durationSeconds,
          };
        });
        return;
      }
    }
  }

  if (monitorCursor.activeSessionId && monitorCursor.activeClassificationKey !== profile.classificationKey) {
    appState.sessions = appState.sessions.map(session => {
      if (session.id !== monitorCursor.activeSessionId) {
        return session;
      }
      const targetEndMs = new Date(sessionStartAt).getTime();
      const lastEndMs = new Date(session.endAt).getTime();
      if (
        !Number.isFinite(targetEndMs) ||
        !Number.isFinite(lastEndMs) ||
        targetEndMs <= lastEndMs ||
        Math.max(0, Math.floor((targetEndMs - lastEndMs) / 1000)) > mergeGapSeconds
      ) {
        return session;
      }
      const fallbackDurationSeconds = Math.max(
        1,
        Math.floor((targetEndMs - new Date(session.startAt).getTime()) / 1000),
      );
      return {
        ...session,
        endAt: sessionStartAt,
        durationSeconds: fallbackDurationSeconds,
      };
    });
  }

  monitorCursor.activeSessionId = makeId('session');
  monitorCursor.activeClassificationKey = profile.classificationKey;

  appState.sessions.push({
    id: monitorCursor.activeSessionId,
    startAt: sessionStartAt,
    endAt: nowIso,
    durationSeconds:
      durationDeltaSeconds === undefined
        ? Math.max(
            1,
            Math.floor((new Date(nowIso).getTime() - new Date(sessionStartAt).getTime()) / 1000),
          )
        : Math.max(1, durationDeltaSeconds),
    classificationKey: profile.classificationKey,
    displayName: profile.displayName,
    objectType: profile.objectType,
    categoryAtThatTime: profile.category,
    processName: profile.processName,
    windowTitle: profile.normalizedTitle,
    browserTabTitle: profile.objectType === 'BrowserTab' ? profile.normalizedTitle : undefined,
    domain: profile.domain,
    isDesktop: profile.objectType === 'Desktop',
  });

  if (appState.sessions.length > MAX_SESSIONS) {
    appState.sessions = appState.sessions.slice(-MAX_SESSIONS);
  }
}

function getActiveFocusResumeInfo(classificationKey, focusSegmentStartedAt, nowIso, mergeGapSeconds) {
  if (!monitorCursor.activeSessionId || monitorCursor.activeClassificationKey !== classificationKey) {
    return null;
  }
  const activeSession = appState.sessions.find(session => session.id === monitorCursor.activeSessionId);
  if (!activeSession) {
    return null;
  }
  const focusStartMs = new Date(focusSegmentStartedAt).getTime();
  const lastEndMs = new Date(activeSession.endAt).getTime();
  if (!Number.isFinite(focusStartMs) || !Number.isFinite(lastEndMs)) {
    return {
      gapSeconds: 0,
      continuousSeconds: 0,
    };
  }
  const gapSeconds = Math.max(0, Math.floor((focusStartMs - lastEndMs) / 1000));
  if (gapSeconds > mergeGapSeconds) {
    return null;
  }
  const nowMs = new Date(nowIso).getTime();
  const sessionStartMs = new Date(activeSession.startAt).getTime();
  return {
    gapSeconds,
    continuousSeconds:
      Number.isFinite(nowMs) && Number.isFinite(sessionStartMs)
        ? Math.max(0, Math.floor((nowMs - sessionStartMs) / 1000))
        : 0,
  };
}

function shouldExpireActiveFocusSession(nowIso, mergeGapSeconds) {
  if (!monitorCursor.activeSessionId) {
    return false;
  }
  const activeSession = appState.sessions.find(session => session.id === monitorCursor.activeSessionId);
  if (!activeSession) {
    return true;
  }
  const nowMs = new Date(nowIso).getTime();
  const lastEndMs = new Date(activeSession.endAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastEndMs)) {
    return false;
  }
  return Math.max(0, Math.floor((nowMs - lastEndMs) / 1000)) > mergeGapSeconds;
}

function addPowerEvent(eventType, detail, markerColor) {
  appState.powerEvents.push({
    id: makeId('power'),
    eventType,
    occurredAt: new Date().toISOString(),
    detail,
    markerColor,
  });

  if (appState.powerEvents.length > MAX_POWER_EVENTS) {
    appState.powerEvents = appState.powerEvents.slice(-MAX_POWER_EVENTS);
  }
  scheduleSave();
  emitState();
}

function parseBrowserBridgePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }

  const browserId = normalizeBrowserId(rawPayload.browser);
  if (!browserId) {
    return null;
  }

  const openDomainSet = new Set();
  const openUrlSet = new Set();
  if (Array.isArray(rawPayload.openDomains)) {
    for (const item of rawPayload.openDomains) {
      const domain = normalizeDomain(item);
      if (domain) {
        openDomainSet.add(domain);
      }
    }
  }
  if (Array.isArray(rawPayload.openUrls)) {
    for (const item of rawPayload.openUrls) {
      const normalizedUrl = normalizeWebUrl(item);
      if (normalizedUrl) {
        openUrlSet.add(normalizedUrl);
      }
      const domain = safeParseDomainFromUrl(normalizedUrl || item);
      if (domain) {
        openDomainSet.add(domain);
      }
    }
  }

  const activeUrl = normalizeWebUrl(rawPayload.activeUrl) || null;
  const activeDomain =
    normalizeDomain(rawPayload.activeDomain) ||
    safeParseDomainFromUrl(activeUrl) ||
    null;
  if (activeUrl) {
    openUrlSet.add(activeUrl);
  }
  if (activeDomain) {
    openDomainSet.add(activeDomain);
  }

  return {
    browserId,
    activeDomain,
    activeUrl,
    openDomains: [...openDomainSet],
    openUrls: [...openUrlSet],
    updatedAtMs: Date.now(),
    updatedAtIso: new Date().toISOString(),
  };
}

function normalizeProfileObjectType(value, fallback = 'AppWindow') {
  return value === 'BrowserTab' || value === 'Desktop' ? value : fallback;
}

function normalizePluginRecord(record, pluginId) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const explicitKey = normalizePluginClassificationKey(record.classificationKey);
  const fallbackKey = typeof record.key === 'string' ? record.key.trim() : '';
  const keyPart = explicitKey || fallbackKey;
  if (!keyPart) {
    return null;
  }

  const classificationKey = explicitKey || `plugin|${pluginId}|${keyPart}`.slice(0, 300);
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim()
      : classificationKey;
  const normalizedTitle =
    typeof record.normalizedTitle === 'string' && record.normalizedTitle.trim()
      ? record.normalizedTitle.trim()
      : displayName;
  const processName =
    typeof record.processName === 'string' && record.processName.trim()
      ? record.processName.trim().toLowerCase()
      : 'plugin';

  return {
    id: makeId('profile'),
    classificationKey,
    displayName,
    objectType: normalizeProfileObjectType(record.objectType),
    processName,
    browserName: typeof record.browserName === 'string' ? record.browserName : undefined,
    normalizedTitle,
    domain: typeof record.domain === 'string' ? normalizeDomain(record.domain) || undefined : undefined,
    category: DEFAULT_CATEGORY,
    isBuiltIn: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePluginSuppressRules(rawRules) {
  if (!Array.isArray(rawRules)) {
    return [];
  }
  return rawRules
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const namePattern = normalizePatternInput(item.namePattern);
      const typePattern = normalizePatternInput(item.typePattern);
      const processPattern = normalizePatternInput(item.processPattern);
      if (!namePattern && !typePattern && !processPattern) {
        return null;
      }
      return {
        namePattern: namePattern || undefined,
        typePattern: typePattern || undefined,
        processPattern: processPattern || undefined,
      };
    })
    .filter(Boolean);
}

function normalizePluginClassificationKey(key) {
  if (typeof key !== 'string') {
    return '';
  }
  const normalized = key.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('plugin-whitelist|')) {
    return `${PROCESS_WHITELIST_KEY_PREFIX}|${normalized.slice('plugin-whitelist|'.length)}`;
  }
  return normalized;
}

function normalizePluginCompatibility(rawCompatibility) {
  if (!Array.isArray(rawCompatibility)) {
    return [];
  }
  return rawCompatibility
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const pluginVersion = typeof item.pluginVersion === 'string' ? item.pluginVersion.trim() : '';
      const compatibleKewuToolboxVersions =
        typeof item.compatibleKewuToolboxVersions === 'string'
          ? item.compatibleKewuToolboxVersions.trim()
          : '';
      if (!pluginVersion || !compatibleKewuToolboxVersions) {
        return null;
      }
      return {
        pluginVersion,
        compatibleKewuToolboxVersions,
        protocolVersion:
          typeof item.protocolVersion === 'string' && item.protocolVersion.trim()
            ? item.protocolVersion.trim()
            : undefined,
        notes:
          typeof item.notes === 'string' && item.notes.trim()
            ? item.notes.trim()
            : undefined,
      };
    })
    .filter(Boolean);
}

function parsePluginBridgePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }

  const rawPlugin = rawPayload.plugin && typeof rawPayload.plugin === 'object' ? rawPayload.plugin : {};
  const pluginId = typeof rawPlugin.id === 'string' ? rawPlugin.id.trim() : '';
  const pluginName = typeof rawPlugin.name === 'string' ? rawPlugin.name.trim() : '';
  const pluginVersion = typeof rawPlugin.version === 'string' ? rawPlugin.version.trim() : '';
  if (!pluginId || !pluginName || !pluginVersion) {
    return null;
  }

  const snapshot = rawPayload.snapshot && typeof rawPayload.snapshot === 'object' ? rawPayload.snapshot : rawPayload;
  const normalizedRecords = (Array.isArray(snapshot.records) ? snapshot.records : [])
    .map(record => normalizePluginRecord(record, pluginId))
    .filter(Boolean);
  const focusedClassificationKeys = [
    ...(Array.isArray(snapshot.focusedClassificationKeys) ? snapshot.focusedClassificationKeys : []),
    typeof snapshot.focusedClassificationKey === 'string' ? snapshot.focusedClassificationKey : '',
  ]
    .map(key => normalizePluginClassificationKey(key))
    .filter(Boolean);
  const uniqueFocusedClassificationKeys = [...new Set(focusedClassificationKeys)];
  const focusedClassificationKey = uniqueFocusedClassificationKeys[0] ?? null;

  const nowIso = new Date().toISOString();
  const existing = pluginBridgeState.byPlugin.get(pluginId);
  return {
    pluginId,
    pluginName,
    pluginVersion,
    compatibility: normalizePluginCompatibility(rawPlugin.compatibility),
    protocolVersion:
      typeof rawPayload.protocolVersion === 'string'
        ? rawPayload.protocolVersion
        : typeof rawPlugin.protocolVersion === 'string'
          ? rawPlugin.protocolVersion
          : undefined,
    homepageUrl:
      typeof rawPlugin.homepageUrl === 'string' && rawPlugin.homepageUrl.trim()
        ? rawPlugin.homepageUrl.trim()
        : undefined,
    source:
      typeof rawPayload.source === 'string' && rawPayload.source.trim()
        ? rawPayload.source.trim()
        : undefined,
    isOfficial: Boolean(rawPlugin.isOfficial),
    records: normalizedRecords,
    suppressRules: normalizePluginSuppressRules(snapshot.suppressRules),
    focusedClassificationKey,
    focusedClassificationKeys: uniqueFocusedClassificationKeys,
    connectedAt: existing?.connectedAt || nowIso,
    updatedAtIso: nowIso,
    updatedAtMs: Date.now(),
  };
}

function normalizePluginRuleMatchCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates)) {
    return [];
  }
  return rawCandidates
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const candidateKey =
        typeof item.candidateKey === 'string' && item.candidateKey.trim()
          ? item.candidateKey.trim()
          : typeof item.key === 'string' && item.key.trim()
            ? item.key.trim()
            : '';
      if (!candidateKey) {
        return null;
      }
      const displayName =
        typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName.trim()
          : candidateKey;
      const normalizedTitle =
        typeof item.normalizedTitle === 'string' && item.normalizedTitle.trim()
          ? item.normalizedTitle.trim()
          : displayName;
      const processName =
        typeof item.processName === 'string' && item.processName.trim()
          ? item.processName.trim().toLowerCase()
          : 'plugin';
      const domain =
        typeof item.domain === 'string' && item.domain.trim()
          ? normalizeDomain(item.domain)
          : safeParseDomainFromUrl(normalizedTitle);

      return {
        candidateKey,
        profile: {
          classificationKey: candidateKey,
          displayName,
          objectType: normalizeProfileObjectType(item.objectType, 'BrowserTab'),
          processName,
          normalizedTitle,
          domain: domain || undefined,
        },
      };
    })
    .filter(Boolean);
}

function buildRuleMatchResponse(rawCandidates) {
  const candidates = normalizePluginRuleMatchCandidates(rawCandidates);
  const whitelistRules = appState.preferences?.processWhitelist ?? [];
  const blacklistRules = appState.preferences?.processBlacklist ?? [];

  return candidates.map(candidate => {
    const whitelist = whitelistRules
      .filter(rule => matchesProcessRule(rule, candidate.profile))
      .map(rule => ({
        id: rule.id,
        name: normalizeWhitelistName(
          rule.name,
          rule.namePattern || rule.typePattern || rule.processPattern || rule.id,
        ),
        namePattern: rule.namePattern || '',
        typePattern: rule.typePattern || '',
        processPattern: rule.processPattern || '',
      }));
    const blacklist = blacklistRules
      .filter(rule => matchesProcessRule(rule, candidate.profile))
      .map(rule => ({
        id: rule.id,
        namePattern: rule.namePattern || '',
        typePattern: rule.typePattern || '',
        processPattern: rule.processPattern || '',
      }));

    return {
      candidateKey: candidate.candidateKey,
      whitelist,
      blacklist,
    };
  });
}

function getActivePluginSnapshots(nowMs = Date.now()) {
  const activeSnapshots = [];
  for (const [pluginId, snapshot] of pluginBridgeState.byPlugin.entries()) {
    if (!snapshot || nowMs - snapshot.updatedAtMs > BROWSER_BRIDGE_STALE_MS) {
      pluginBridgeState.byPlugin.delete(pluginId);
      continue;
    }
    activeSnapshots.push(snapshot);
  }
  return activeSnapshots;
}

function syncPluginConnectionsToState(activeSnapshots = getActivePluginSnapshots()) {
  appState.pluginConnections = activeSnapshots
    .map(snapshot => ({
      pluginId: snapshot.pluginId,
      pluginName: snapshot.pluginName,
      pluginVersion: snapshot.pluginVersion,
      compatibility: Array.isArray(snapshot.compatibility) ? snapshot.compatibility : [],
      protocolVersion: snapshot.protocolVersion,
      homepageUrl: snapshot.homepageUrl,
      source: snapshot.source,
      connectedAt: snapshot.connectedAt,
      lastSeenAt: snapshot.updatedAtIso,
      isOfficial: snapshot.isOfficial,
      recordCount: Array.isArray(snapshot.records) ? snapshot.records.length : 0,
    }))
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

function getFocusedProfilesFromPlugins(activeSnapshots) {
  let selected = null;
  for (const snapshot of activeSnapshots) {
    const focusedKeys = Array.isArray(snapshot?.focusedClassificationKeys) && snapshot.focusedClassificationKeys.length > 0
      ? snapshot.focusedClassificationKeys
      : snapshot?.focusedClassificationKey
        ? [snapshot.focusedClassificationKey]
        : [];
    if (!snapshot || focusedKeys.length === 0) {
      continue;
    }
    const keySet = new Set(focusedKeys.map(key => normalizePluginClassificationKey(key)).filter(Boolean));
    const records = (snapshot.records || []).filter(
      item => item && keySet.has(item.classificationKey),
    );
    if (records.length === 0) {
      continue;
    }
    if (!selected || snapshot.updatedAtMs > selected.updatedAtMs) {
      selected = {
        updatedAtMs: snapshot.updatedAtMs,
        profiles: records.map(record => ({
          ...record,
          id: makeId('profile'),
          updatedAt: new Date().toISOString(),
        })),
      };
    }
  }
  return selected?.profiles ?? [];
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function startBrowserBridgeServer() {
  if (browserBridgeServer) {
    return;
  }

  browserBridgeServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, { ok: true });
    }
    if (req.method === 'GET' && req.url === BROWSER_BRIDGE_HEALTH_ROUTE) {
      return sendJson(res, 200, { ok: true, port: BROWSER_BRIDGE_PORT });
    }
    if (req.method !== 'POST' || (req.url !== BROWSER_BRIDGE_ROUTE && req.url !== PLUGIN_BRIDGE_ROUTE)) {
      return sendJson(res, 404, { ok: false, error: 'not_found' });
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 256) {
        req.destroy();
      }
    });

    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_json' });
      }

      if (req.url === BROWSER_BRIDGE_ROUTE) {
        const normalized = parseBrowserBridgePayload(parsed);
        if (!normalized) {
          return sendJson(res, 400, { ok: false, error: 'invalid_payload' });
        }

        browserBridgeState.byBrowser.set(normalized.browserId, {
          activeDomain: normalized.activeDomain,
          activeUrl: normalized.activeUrl,
          openDomains: normalized.openDomains,
          openUrls: normalized.openUrls,
          updatedAtMs: normalized.updatedAtMs,
          updatedAtIso: normalized.updatedAtIso,
        });

        return sendJson(res, 200, { ok: true });
      }

      if (parsed && parsed.requestType === 'match-rules') {
        const matches = buildRuleMatchResponse(parsed.candidates);
        return sendJson(res, 200, {
          ok: true,
          requestType: 'match-rules',
          matches,
          updatedAt: new Date().toISOString(),
        });
      }

      const normalizedPlugin = parsePluginBridgePayload(parsed);
      if (!normalizedPlugin) {
        return sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      }

      pluginBridgeState.byPlugin.set(normalizedPlugin.pluginId, normalizedPlugin);
      syncPluginConnectionsToState();
      emitState();
      return sendJson(res, 200, { ok: true });
    });
  });

  browserBridgeServer.listen(BROWSER_BRIDGE_PORT, '127.0.0.1');
  browserBridgeServer.on('error', () => {
    // Ignore bridge binding failures.
  });
}

function stopBrowserBridgeServer() {
  if (!browserBridgeServer) {
    return;
  }
  try {
    browserBridgeServer.close();
  } catch {
    // Ignore close errors.
  }
  browserBridgeServer = null;
}

async function getActiveWinApi() {
  if (!activeWinApi) {
    const mod = await import('active-win');
    activeWinApi = mod.default;
  }
  return activeWinApi;
}

async function monitorTick() {
  const now = new Date();
  const nowIso = now.toISOString();
  pruneCodeWindowIdentityCache(now.getTime());
  const nowMs = now.getTime();
  const lastTickMs = monitorCursor.lastTickAtMs ?? nowMs;
  const elapsedMs = Math.max(0, nowMs - lastTickMs);
  monitorCursor.lastTickAtMs = nowMs;
  const totalMs = monitorCursor.carryMs + elapsedMs;
  const deltaSeconds = Math.floor(totalMs / 1000);
  monitorCursor.carryMs = totalMs - deltaSeconds * 1000;

  const activeWin = await getActiveWinApi();
  let focusedRaw = null;
  let openWindows = [];

  const focusedPromise =
    typeof activeWin === 'function' ? activeWin().catch(() => null) : Promise.resolve(null);
  const openWindowsPromise =
    typeof activeWin?.getOpenWindows === 'function'
      ? activeWin.getOpenWindows().catch(() => [])
      : Promise.resolve([]);

  [focusedRaw, openWindows] = await Promise.all([focusedPromise, openWindowsPromise]);
  if (!Array.isArray(openWindows)) {
    openWindows = [];
  }

  // Keep monitoring usable on environments where open-window enumeration is flaky.
  if (focusedRaw && !openWindows.some(item => item && item.id === focusedRaw.id)) {
    openWindows.push(focusedRaw);
  }
  const activePluginSnapshots = getActivePluginSnapshots();
  syncPluginConnectionsToState(activePluginSnapshots);
  const pluginSuppressRules = collectPluginSuppressRules(activePluginSnapshots);

  const bucket = new Map();
  for (const rawWindow of openWindows) {
    const candidate = toNonBrowserProfile(rawWindow);
    if (!candidate || shouldIgnoreByBlacklist(candidate) || shouldSuppressByPluginRules(candidate, pluginSuppressRules)) {
      continue;
    }
    const expandedProfiles = applyProcessWhitelistToProfile(candidate);
    for (const expandedProfile of expandedProfiles) {
      if (!expandedProfile || shouldIgnoreByBlacklist(expandedProfile)) {
        continue;
      }
      bucket.set(expandedProfile.classificationKey, expandedProfile);
    }
  }

  for (const candidate of getFreshBridgeOpenProfiles()) {
    if (!candidate || shouldIgnoreByBlacklist(candidate)) {
      continue;
    }
    const expandedProfiles = applyProcessWhitelistToProfile(candidate);
    for (const expandedProfile of expandedProfiles) {
      if (!expandedProfile || shouldIgnoreByBlacklist(expandedProfile)) {
        continue;
      }
      bucket.set(expandedProfile.classificationKey, expandedProfile);
    }
  }

  for (const pluginProfile of getFreshPluginProfiles(activePluginSnapshots)) {
    if (!pluginProfile || shouldIgnoreByBlacklist(pluginProfile)) {
      continue;
    }
    const expandedProfiles = applyProcessWhitelistToProfile(pluginProfile);
    for (const expandedProfile of expandedProfiles) {
      if (!expandedProfile || shouldIgnoreByBlacklist(expandedProfile)) {
        continue;
      }
      bucket.set(expandedProfile.classificationKey, expandedProfile);
    }
  }

  let focusedCandidate = toFocusedWindowProfile(focusedRaw);
  if (
    focusedCandidate &&
    (shouldIgnoreByBlacklist(focusedCandidate) ||
      shouldSuppressByPluginRules(focusedCandidate, pluginSuppressRules))
  ) {
    focusedCandidate = null;
  }
  const rawFocusedCandidates = focusedCandidate
    ? [focusedCandidate]
    : getFocusedProfilesFromPlugins(activePluginSnapshots);
  const focusedCandidates = rawFocusedCandidates
    .flatMap(candidate => applyProcessWhitelistToProfile(candidate))
    .filter(profile => profile && !shouldIgnoreByBlacklist(profile));
  const primaryFocusedCandidate = focusedCandidates[0] ?? null;

  const focusedKeySet = new Set();
  if (primaryFocusedCandidate) {
    focusedKeySet.add(primaryFocusedCandidate.classificationKey);
  }
  for (const profile of focusedCandidates) {
    focusedKeySet.add(profile.classificationKey);
    bucket.set(profile.classificationKey, profile);
  }

  let focusedProfile = null;
  let currentFocusedWindow = null;

  if (primaryFocusedCandidate) {
    bucket.set(primaryFocusedCandidate.classificationKey, primaryFocusedCandidate);
  }

  const openKeys = new Set(bucket.keys());
  const recordThresholdSeconds = normalizeRecordWindowThresholdSeconds(
    appState.preferences?.recordWindowThresholdSeconds,
    DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS,
  );
  const visibleDeltasByKey = new Map();
  const focusDeltasByKey = new Map();
  let activeFocusSessionStartAt = null;

  for (const [key, candidate] of bucket.entries()) {
    const isFocusedWindow = focusedKeySet.has(key);
    const focusDelta = isFocusedWindow ? deltaSeconds : 0;
    const profile = ensureProfile(candidate);
    const existingPending = pendingWindowRuntime.get(key);
    const recentlyClosed = !existingPending ? recentlyClosedWindowRuntime.get(key) : null;
    const canResumeClosedRuntime =
      recentlyClosed &&
      Number.isFinite(Number(recentlyClosed.closedAtMs)) &&
      nowMs - Number(recentlyClosed.closedAtMs) <= recordThresholdSeconds * 1000;
    const pending = existingPending ?? (canResumeClosedRuntime
      ? recentlyClosed
      : {
          firstSeenAt: new Date(nowMs - deltaSeconds * 1000).toISOString(),
          totalVisibleSeconds: 0,
          totalFocusSeconds: 0,
          currentContinuousFocusSeconds: 0,
          longestContinuousFocusSeconds: 0,
          lastFocusAt: '',
          recorded: false,
          processTimelineId: undefined,
          focusSegmentStartedAt: undefined,
          focusSegmentRecordedSeconds: 0,
        });
    if (canResumeClosedRuntime) {
      const closedGapSeconds = Math.max(
        0,
        Math.floor((nowMs - Number(recentlyClosed.closedAtMs)) / 1000),
      );
      pending.totalVisibleSeconds += closedGapSeconds;
      pending.resumedVisibleGapSeconds =
        (Number(pending.resumedVisibleGapSeconds) || 0) + closedGapSeconds;
      delete pending.closedAtMs;
      recentlyClosedWindowRuntime.delete(key);
    }
    if (!pending.firstSeenAt) {
      pending.firstSeenAt = new Date(nowMs - deltaSeconds * 1000).toISOString();
    }
    pending.totalVisibleSeconds += deltaSeconds;

    let confirmedFocusDelta = 0;
    let resumesActiveFocus = false;
    let resumeFocusGapSeconds = 0;
    let effectiveContinuousFocusSeconds = 0;
    if (focusDelta > 0) {
      if (pending.currentContinuousFocusSeconds <= 0 || !pending.focusSegmentStartedAt) {
        pending.focusSegmentStartedAt = new Date(nowMs - focusDelta * 1000).toISOString();
        pending.focusSegmentRecordedSeconds = 0;
      }
      const resumeInfo = getActiveFocusResumeInfo(
        key,
        pending.focusSegmentStartedAt,
        nowIso,
        recordThresholdSeconds,
      );
      resumesActiveFocus = Boolean(resumeInfo);
      resumeFocusGapSeconds = resumeInfo?.gapSeconds ?? 0;
      pending.currentContinuousFocusSeconds += focusDelta;
      effectiveContinuousFocusSeconds = resumesActiveFocus
        ? Math.max(pending.currentContinuousFocusSeconds, resumeInfo?.continuousSeconds ?? 0)
        : pending.currentContinuousFocusSeconds;
      const reachedFocusThreshold = pending.currentContinuousFocusSeconds >= recordThresholdSeconds;
      if (resumesActiveFocus || reachedFocusThreshold) {
        const recordedFocusSeconds = Number(pending.focusSegmentRecordedSeconds) || 0;
        const resumeGapToApply = resumesActiveFocus && recordedFocusSeconds <= 0 ? resumeFocusGapSeconds : 0;
        confirmedFocusDelta =
          resumeGapToApply + Math.max(0, pending.currentContinuousFocusSeconds - recordedFocusSeconds);
        pending.focusSegmentRecordedSeconds = pending.currentContinuousFocusSeconds;
        pending.totalFocusSeconds += confirmedFocusDelta;
        if (confirmedFocusDelta > 0) {
          pending.longestContinuousFocusSeconds = Math.max(
            pending.longestContinuousFocusSeconds,
            effectiveContinuousFocusSeconds,
          );
          pending.lastFocusAt = nowIso;
        }
      }
    } else {
      pending.currentContinuousFocusSeconds = 0;
      pending.focusSegmentStartedAt = undefined;
      pending.focusSegmentRecordedSeconds = 0;
    }

    const isRecordEligible = pending.recorded || pending.totalVisibleSeconds >= recordThresholdSeconds;
    if (isRecordEligible) {
      const resumedVisibleGapSeconds = Math.max(0, Math.floor(Number(pending.resumedVisibleGapSeconds) || 0));
      const visibleDelta = pending.recorded ? deltaSeconds + resumedVisibleGapSeconds : pending.totalVisibleSeconds;
      const focusDeltaToApply = pending.recorded ? confirmedFocusDelta : pending.totalFocusSeconds;
      upsertWindowStat(profile, visibleDelta, focusDeltaToApply, {
        lastFocusAt: pending.lastFocusAt,
        longestContinuousFocusSeconds: pending.longestContinuousFocusSeconds,
      });
      upsertProcessTimeline(profile, pending, nowIso);
      if (visibleDelta > 0) {
        visibleDeltasByKey.set(key, visibleDelta);
      }
      if (focusDeltaToApply > 0) {
        focusDeltasByKey.set(key, focusDeltaToApply);
      }
      pending.recorded = true;
      flushPendingInputActivity(profile, pending, nowIso);
      pending.resumedVisibleGapSeconds = 0;
      const isFocusEligible = isFocusedWindow && (confirmedFocusDelta > 0 || resumesActiveFocus);
      if (isFocusEligible && primaryFocusedCandidate && key === primaryFocusedCandidate.classificationKey) {
        focusedProfile = profile;
        currentFocusedWindow = profile;
        activeFocusSessionStartAt = pending.focusSegmentStartedAt ?? nowIso;
      } else if (isFocusEligible && !currentFocusedWindow) {
        focusedProfile = focusedProfile ?? profile;
        currentFocusedWindow = profile;
        activeFocusSessionStartAt = activeFocusSessionStartAt ?? pending.focusSegmentStartedAt ?? nowIso;
      } else if (isFocusedWindow && !currentFocusedWindow) {
        currentFocusedWindow = profile;
      }
    } else if (isFocusedWindow) {
      if (primaryFocusedCandidate && key === primaryFocusedCandidate.classificationKey) {
        currentFocusedWindow = profile;
      } else if (!currentFocusedWindow) {
        currentFocusedWindow = profile;
      }
    }

    pendingWindowRuntime.set(key, pending);
  }

  for (const key of [...pendingWindowRuntime.keys()]) {
    if (!openKeys.has(key)) {
      const pending = pendingWindowRuntime.get(key);
      finalizeProcessTimeline(pending, nowIso);
      if (pending) {
        pending.closedAtMs = nowMs;
        recentlyClosedWindowRuntime.set(key, pending);
      }
      pendingWindowRuntime.delete(key);
    }
  }

  for (const [key, pending] of [...recentlyClosedWindowRuntime.entries()]) {
    if (
      !pending ||
      !Number.isFinite(Number(pending.closedAtMs)) ||
      nowMs - Number(pending.closedAtMs) > recordThresholdSeconds * 1000
    ) {
      recentlyClosedWindowRuntime.delete(key);
    }
  }

  syncCurrentProcessRuntimeStats();
  appState.currentProcessKeys = [...bucket.keys()];
  appState.currentFocusedWindow = currentFocusedWindow;

  const assignmentMap = getProcessTagAssignmentMap();
  const focusedTagId = focusedProfile ? assignmentMap.get(focusedProfile.classificationKey)?.tagId ?? null : null;
  const focusedTagDelta = focusedProfile ? focusDeltasByKey.get(focusedProfile.classificationKey) || 0 : 0;
  if (deltaSeconds > 0) {
    if (focusedTagId && focusedTagDelta > 0) {
      if (monitorCursor.activeTagId === focusedTagId) {
        monitorCursor.tagFocusStreakSeconds += focusedTagDelta;
      } else {
        monitorCursor.activeTagId = focusedTagId;
        monitorCursor.tagFocusStreakSeconds = focusedTagDelta;
      }
    } else if (!currentFocusedWindow) {
      monitorCursor.activeTagId = null;
      monitorCursor.tagFocusStreakSeconds = 0;
    }
  }
  updateProcessTagStats(
    visibleDeltasByKey,
    focusDeltasByKey,
    nowIso,
    monitorCursor.tagFocusStreakSeconds,
  );

  if (focusedProfile && deltaSeconds > 0) {
    upsertActiveSession(focusedProfile, nowIso, {
      startAt: activeFocusSessionStartAt ?? nowIso,
      durationDeltaSeconds: focusDeltasByKey.get(focusedProfile.classificationKey) || 0,
      mergeGapSeconds: recordThresholdSeconds,
    });
  } else if (!currentFocusedWindow) {
    if (shouldExpireActiveFocusSession(nowIso, recordThresholdSeconds)) {
      monitorCursor.activeSessionId = null;
      monitorCursor.activeClassificationKey = null;
    }
    monitorCursor.activeTagId = null;
    monitorCursor.tagFocusStreakSeconds = 0;
  }

  scheduleSave();
  emitState();
}

function startMonitoring() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
  }
  monitorCursor.lastTickAtMs = Date.now();
  monitorCursor.carryMs = 0;
  monitorCursor.activeTagId = null;
  monitorCursor.tagFocusStreakSeconds = 0;
  monitorTimer = setInterval(() => {
    monitorTick().catch(error => {
      console.error('[monitorTick] tick failed', error);
    });
  }, POLL_INTERVAL_MS);

  void monitorTick();
}

function stopMonitoring() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

function mergeUserStateFromRenderer(partial) {
  if (!partial || typeof partial !== 'object') {
    return;
  }
  const next = partial;

  if (Array.isArray(next.subjects)) {
    appState.subjects = next.subjects;
  }
  if (Array.isArray(next.queue)) {
    appState.queue = next.queue;
  }
  if (Array.isArray(next.stopwatchRecords)) {
    appState.stopwatchRecords = next.stopwatchRecords;
  }
  if (Array.isArray(next.countdownTasks)) {
    appState.countdownTasks = next.countdownTasks;
  }
  if (Array.isArray(next.todos)) {
    appState.todos = next.todos;
  }
  if (Array.isArray(next.archives)) {
    appState.archives = next.archives;
  }
  if (Array.isArray(next.soundFiles)) {
    appState.soundFiles = next.soundFiles;
  }
  if (next.preferences && typeof next.preferences === 'object') {
    const requestedAutoLaunchEnabled = normalizeAutoLaunchEnabled(
      next.preferences.autoLaunchEnabled,
      appState.preferences.autoLaunchEnabled,
    );
    const normalizedProcessWhitelist = normalizeProcessWhitelistRules(
      next.preferences.processWhitelist ?? next.preferences.urlWhitelist,
      appState.preferences.processWhitelist,
    );
    const normalizedProcessBlacklist = normalizeProcessBlacklistRules(
      next.preferences.processBlacklist,
      appState.preferences.processBlacklist,
    );
    const resolvedAutoLaunchEnabled =
      requestedAutoLaunchEnabled === appState.preferences.autoLaunchEnabled
        ? appState.preferences.autoLaunchEnabled
        : applySystemAutoLaunchEnabled(requestedAutoLaunchEnabled);
    appState.preferences = {
      ...appState.preferences,
      recordWindowThresholdSeconds: normalizeRecordWindowThresholdSeconds(
        next.preferences.recordWindowThresholdSeconds,
        appState.preferences.recordWindowThresholdSeconds,
      ),
      analyticsWindowItemLimit: normalizeAnalyticsWindowItemLimit(
        next.preferences.analyticsWindowItemLimit,
        appState.preferences.analyticsWindowItemLimit,
      ),
      uiTheme: normalizeUiTheme(next.preferences.uiTheme, appState.preferences.uiTheme),
      autoLaunchEnabled: resolvedAutoLaunchEnabled,
      processWhitelist: normalizedProcessWhitelist,
      processBlacklist: normalizedProcessBlacklist,
      countdownCompletedTaskBehavior: normalizeCountdownCompletedTaskBehavior(
        next.preferences.countdownCompletedTaskBehavior,
        appState.preferences.countdownCompletedTaskBehavior,
      ),
      closeWindowBehavior: normalizeCloseWindowBehavior(
        next.preferences.closeWindowBehavior,
        appState.preferences.closeWindowBehavior,
      ),
    };
    applyWhitelistNamesToState();
  }
  if (next.pomodoroSettings && typeof next.pomodoroSettings === 'object') {
    appState.pomodoroSettings = {
      ...appState.pomodoroSettings,
      ...next.pomodoroSettings,
    };
  }
  if (typeof next.displayMode === 'string') {
    appState.displayMode = next.displayMode;
  }
  if (next.uiState && typeof next.uiState === 'object') {
    appState.uiState = {
      ...appState.uiState,
      ...next.uiState,
      monitoring: {
        ...appState.uiState?.monitoring,
        ...(next.uiState.monitoring ?? {}),
      },
      clock: {
        ...appState.uiState?.clock,
        ...(next.uiState.clock ?? {}),
      },
    };
  }

  if (Array.isArray(next.processTags)) {
    appState.processTags = next.processTags;
  }

  const validTagSet = new Set(appState.processTags.map(tag => tag.id));
  if (Array.isArray(next.processTagAssignments)) {
    appState.processTagAssignments = next.processTagAssignments.filter(item => validTagSet.has(item.tagId));
  } else {
    appState.processTagAssignments = appState.processTagAssignments.filter(item => validTagSet.has(item.tagId));
  }
  appState.processTagStats = appState.processTagStats.filter(item => validTagSet.has(item.tagId));

  if (Array.isArray(next.profiles)) {
    const incomingProfiles = next.profiles.filter(
      profile =>
        profile &&
        typeof profile.classificationKey === 'string' &&
        typeof profile.category === 'string',
    );
    const incomingKeySet = new Set(incomingProfiles.map(profile => profile.classificationKey));
    const incomingCategoryMap = new Map(
      incomingProfiles.map(profile => [profile.classificationKey, profile.category]),
    );
    const nowIso = new Date().toISOString();

    const existingProfileMap = new Map(appState.profiles.map(profile => [profile.classificationKey, profile]));
    appState.profiles = incomingProfiles.map(profile => {
      const existing = existingProfileMap.get(profile.classificationKey);
      if (!existing) {
        return {
          ...profile,
          updatedAt: nowIso,
        };
      }
      return {
        ...existing,
        category: incomingCategoryMap.get(profile.classificationKey) ?? existing.category,
        updatedAt: nowIso,
      };
    });

    appState.windowStats = appState.windowStats
      .filter(item => incomingKeySet.has(item.classificationKey))
      .map(item => ({
        ...item,
        category: incomingCategoryMap.get(item.classificationKey) ?? item.category,
      }));

    appState.sessions = appState.sessions.filter(session => incomingKeySet.has(session.classificationKey));
    appState.processTimeline = (appState.processTimeline || []).filter(item =>
      incomingKeySet.has(item.classificationKey),
    );
    appState.inputActivityStats = (appState.inputActivityStats || []).filter(item =>
      incomingKeySet.has(item.classificationKey),
    );
    appState.inputActivityTimeline = (appState.inputActivityTimeline || []).filter(item =>
      incomingKeySet.has(item.classificationKey),
    );
    appState.currentProcessKeys = appState.currentProcessKeys.filter(key => incomingKeySet.has(key));
    appState.currentProcessRuntimeStats = (appState.currentProcessRuntimeStats || []).filter(item =>
      incomingKeySet.has(item.classificationKey),
    );
    appState.processTagAssignments = appState.processTagAssignments.filter(
      assignment =>
        validTagSet.has(assignment.tagId) && incomingKeySet.has(assignment.classificationKey),
    );

    for (const key of [...pendingWindowRuntime.keys()]) {
      if (!incomingKeySet.has(key)) {
        finalizeProcessTimeline(pendingWindowRuntime.get(key), nowIso);
        pendingWindowRuntime.delete(key);
      }
    }

    if (
      appState.currentFocusedWindow &&
      !incomingKeySet.has(appState.currentFocusedWindow.classificationKey)
    ) {
      appState.currentFocusedWindow = null;
    }

    if (
      monitorCursor.activeClassificationKey &&
      !incomingKeySet.has(monitorCursor.activeClassificationKey)
    ) {
      monitorCursor.activeClassificationKey = null;
      monitorCursor.activeSessionId = null;
    }
  }
}

function notifySystem(payload) {
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
  if (!title) {
    return { ok: false, error: 'invalid_title' };
  }

  try {
    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) {
      return { ok: false, error: 'unsupported' };
    }
    const notification = new Notification({ title, body });
    notification.show();
    return { ok: true };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

function normalizeVersionText(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[^\dA-Za-z.+-].*$/, '');
}

function compareVersions(left, right) {
  const leftParts = normalizeVersionText(left).split(/[.+-]/).map(part => Number(part));
  const rightParts = normalizeVersionText(right).split(/[.+-]/).map(part => Number(part));
  const length = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
}

function createUpdateRequestHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'KewuToolbox-Updater',
  };
}

async function requestTextWithElectronNet(url) {
  if (!net || typeof net.fetch !== 'function') {
    throw new Error('electron net.fetch is not available');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await net.fetch(url, {
      headers: createUpdateRequestHeaders(),
      redirect: 'follow',
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }
    return raw;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requestTextWithNodeHttps(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: createUpdateRequestHeaders(),
      },
      response => {
        const statusCode = response.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();
          requestTextWithNodeHttps(response.headers.location).then(resolve, reject);
          return;
        }
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          resolve(raw);
        });
      },
    );
    request.setTimeout(15000, () => {
      request.destroy(new Error('request timeout'));
    });
    request.on('error', reject);
  });
}

async function requestText(url) {
  const errors = [];
  try {
    return await requestTextWithElectronNet(url);
  } catch (error) {
    errors.push(`electron-net: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return await requestTextWithNodeHttps(url);
  } catch (error) {
    errors.push(`node-https: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(errors.join('; '));
}

async function requestJson(url) {
  const raw = await requestText(url);
  return JSON.parse(raw);
}

async function resolveFinalUrl(url) {
  const errors = [];
  if (net && typeof net.fetch === 'function') {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 15000);
    try {
      const response = await net.fetch(url, {
        headers: createUpdateRequestHeaders(),
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.body && typeof response.body.cancel === 'function') {
        try {
          await response.body.cancel();
        } catch {
          // Ignore stream cancellation failures.
        }
      }
      return response.url || url;
    } catch (error) {
      if (error?.name === 'AbortError') {
        errors.push('electron-net: request timeout');
      } else {
        errors.push(`electron-net: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    return await new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: createUpdateRequestHeaders(),
        },
        response => {
          const statusCode = response.statusCode || 0;
          const location = response.headers.location;
          response.resume();
          if (statusCode >= 300 && statusCode < 400 && typeof location === 'string' && location.trim()) {
            resolve(new URL(location, url).toString());
            return;
          }
          resolve(url);
        },
      );
      request.setTimeout(15000, () => {
        request.destroy(new Error('request timeout'));
      });
      request.on('error', reject);
    });
  } catch (error) {
    errors.push(`node-https: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(errors.join('; '));
}

function buildPortableUpdateAssetsFromVersion(version) {
  const normalizedVersion = normalizeVersionText(version);
  if (!normalizedVersion) {
    return { portableAsset: null, sha256Asset: null };
  }
  const tag = `v${normalizedVersion}`;
  const portableName = `KewuToolbox-${normalizedVersion}-portable.exe`;
  const portableUrl = `${GITHUB_REPO_URL}/releases/download/${tag}/${portableName}`;
  const sha256Name = `${portableName}.sha256`;
  return {
    portableAsset: {
      name: portableName,
      browser_download_url: portableUrl,
      size: 0,
    },
    sha256Asset: {
      name: sha256Name,
      browser_download_url: `${portableUrl}.sha256`,
      size: 0,
    },
  };
}

async function getLatestReleaseFromRedirect() {
  const finalUrl = await resolveFinalUrl(`${GITHUB_REPO_URL}/releases/latest`);
  const match = /\/releases\/tag\/([^/?#]+)/i.exec(finalUrl);
  if (!match) {
    throw new Error(`cannot resolve latest release tag from ${finalUrl}`);
  }
  const tagName = decodeURIComponent(match[1]);
  const latestVersion = normalizeVersionText(tagName);
  const { portableAsset, sha256Asset } = buildPortableUpdateAssetsFromVersion(latestVersion);
  return {
    tag_name: `v${latestVersion}`,
    name: `KewuToolbox v${latestVersion}`,
    html_url: `${GITHUB_REPO_URL}/releases/tag/v${latestVersion}`,
    body: '',
    published_at: '',
    assets: [portableAsset, sha256Asset].filter(Boolean),
    source: 'github_redirect',
  };
}

function pickPortableUpdateAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const portableAsset = assets.find(asset =>
    asset &&
    typeof asset.name === 'string' &&
    /^KewuToolbox-.+-portable\.exe$/i.test(asset.name) &&
    typeof asset.browser_download_url === 'string',
  );
  if (!portableAsset) {
    return { portableAsset: null, sha256Asset: null };
  }

  const shaName = `${portableAsset.name}.sha256`;
  const sha256Asset = assets.find(asset =>
    asset &&
    typeof asset.name === 'string' &&
    asset.name.toLowerCase() === shaName.toLowerCase() &&
    typeof asset.browser_download_url === 'string',
  );
  return { portableAsset, sha256Asset: sha256Asset || null };
}

async function checkForPortableUpdate() {
  const currentVersion = app.getVersion();
  let apiFailureDetail = '';
  try {
    let release = null;
    try {
      release = await requestJson(GITHUB_LATEST_RELEASE_API_URL);
    } catch (error) {
      apiFailureDetail = error instanceof Error ? error.message : String(error);
      addDiagnosticLog('warn', '检查更新 API 请求失败，尝试使用 GitHub Release 重定向兜底', apiFailureDetail);
      scheduleSave();
      emitState();
      release = await getLatestReleaseFromRedirect();
    }

    const latestVersion = normalizeVersionText(release?.tag_name || release?.name || '');
    if (!latestVersion) {
      return {
        ok: false,
        error: 'invalid_release_version',
        currentVersion,
        repositoryUrl: GITHUB_REPO_URL,
      };
    }

    const { portableAsset, sha256Asset } = pickPortableUpdateAssets(release);
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseName: typeof release?.name === 'string' ? release.name : `KewuToolbox v${latestVersion}`,
      releaseUrl: typeof release?.html_url === 'string' ? release.html_url : `${GITHUB_REPO_URL}/releases/latest`,
      releaseNotes: typeof release?.body === 'string' ? release.body : '',
      publishedAt: typeof release?.published_at === 'string' ? release.published_at : '',
      assetName: portableAsset?.name || '',
      assetUrl: portableAsset?.browser_download_url || '',
      assetSize: Number(portableAsset?.size) || 0,
      sha256Name: sha256Asset?.name || '',
      sha256Url: sha256Asset?.browser_download_url || '',
      repositoryUrl: GITHUB_REPO_URL,
      updateSource: release?.source || 'github_api',
      apiFailureDetail,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addDiagnosticLog('error', '检查更新失败', detail);
    scheduleSave();
    emitState();
    return {
      ok: false,
      error: 'request_failed',
      detail,
      currentVersion,
      repositoryUrl: GITHUB_REPO_URL,
      apiFailureDetail,
    };
  }
}

function resolveCurrentExecutablePath() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_FILE,
    (() => {
      try {
        return app.getPath('exe');
      } catch {
        return null;
      }
    })(),
    process.execPath,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return path.resolve(trimmed);
    }
  }
  return null;
}

function emitUpdateProgress(progress) {
  const payload = {
    ...progress,
    updatedAt: new Date().toISOString(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-progress', payload);
  }
}

function parseSha256Content(content) {
  const match = /[A-Fa-f0-9]{64}/.exec(String(content || ''));
  if (!match) {
    throw new Error('Invalid sha256 file.');
  }
  return match[0].toLowerCase();
}

function resolveUpdateDownloadBaseName(rawAssetName, fallbackTargetName) {
  const assetName = typeof rawAssetName === 'string' ? path.basename(rawAssetName.trim()) : '';
  if (/^KewuToolbox-.+-portable\.exe$/i.test(assetName)) {
    return assetName;
  }
  return fallbackTargetName;
}

function getFileSha256Hex(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadUpdateFile(url, outputPath, progressBase) {
  emitUpdateProgress({
    ...progressBase,
    status: 'running',
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
  });

  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'KewuToolbox-Updater',
    },
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = '';
    }
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  ensureDir(path.dirname(outputPath));

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    let transferredBytes = 0;
    let settled = false;
    let lastEmitAt = 0;

    const report = force => {
      const now = Date.now();
      if (!force && now - lastEmitAt < 200) {
        return;
      }
      lastEmitAt = now;
      emitUpdateProgress({
        ...progressBase,
        status: 'running',
        percent: totalBytes > 0 ? Math.min(100, (transferredBytes / totalBytes) * 100) : undefined,
        transferredBytes,
        totalBytes,
      });
    };

    const fail = error => {
      if (settled) {
        return;
      }
      settled = true;
      output.destroy();
      reject(error);
    };

    output.on('error', fail);
    output.on('finish', () => {
      if (settled) {
        return;
      }
      settled = true;
      report(true);
      resolve();
    });

    const run = async () => {
      try {
        if (!response.body || typeof response.body.getReader !== 'function') {
          const buffer = Buffer.from(await response.arrayBuffer());
          transferredBytes = buffer.length;
          output.end(buffer);
          return;
        }

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = Buffer.from(value);
          transferredBytes += chunk.length;
          if (!output.write(chunk)) {
            await new Promise(resolveDrain => output.once('drain', resolveDrain));
          }
          report(false);
        }
        output.end();
      } catch (error) {
        fail(error);
      }
    };

    void run();
  });

  emitUpdateProgress({
    ...progressBase,
    status: 'success',
    percent: 100,
    transferredBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : undefined,
    totalBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : undefined,
  });
}

function getUpdaterScriptContent() {
  return `param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$TargetPath,
  [Parameter(Mandatory=$true)][string]$DownloadedPath,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'
$targetDir = Split-Path -Parent $TargetPath
$targetName = Split-Path -Leaf $TargetPath
$logPath = Join-Path $targetDir 'KewuToolboxUpdater.log'
$backupPath = $null

function Write-UpdateLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-Sha256Hex([string]$LiteralPath) {
  $stream = [System.IO.File]::OpenRead($LiteralPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($stream)
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
  return -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
}

function Wait-FileUnlocked([string]$LiteralPath, [int]$TimeoutSeconds) {
  if (-not (Test-Path -LiteralPath $LiteralPath)) {
    return
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $stream = $null
    try {
      $stream = [System.IO.File]::Open(
        $LiteralPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
      return
    } catch {
      Start-Sleep -Milliseconds 500
    } finally {
      if ($stream) {
        $stream.Dispose()
      }
    }
  }

  throw "Target executable is still locked: $LiteralPath"
}

try {
  Write-UpdateLog "Updater started. Target=$TargetPath"
  try {
    Wait-Process -Id $ProcessId -Timeout 120 -ErrorAction Stop
  } catch {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      Write-UpdateLog "Main process still running. Force stopping PID=$ProcessId"
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $ProcessId -Timeout 30 -ErrorAction SilentlyContinue
    }
  }

  if (-not (Test-Path -LiteralPath $targetDir)) {
    throw "Target directory does not exist: $targetDir"
  }

  $downloadPath = $DownloadedPath
  $backupPath = Join-Path $targetDir "$targetName.bak"

  if (-not (Test-Path -LiteralPath $downloadPath)) {
    throw "Downloaded update file does not exist: $downloadPath"
  }

  $expectedHash = $ExpectedSha256.ToLowerInvariant()
  $actualHash = Get-Sha256Hex $downloadPath
  if ($actualHash -ne $expectedHash) {
    throw "SHA256 mismatch. Expected=$expectedHash Actual=$actualHash"
  }

  Write-UpdateLog "Waiting for target executable to unlock..."
  Wait-FileUnlocked -LiteralPath $TargetPath -TimeoutSeconds 120

  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $TargetPath) {
    Write-UpdateLog "Backing up old executable..."
    Move-Item -LiteralPath $TargetPath -Destination $backupPath -Force
  }

  try {
    Write-UpdateLog "Replacing executable..."
    Move-Item -LiteralPath $downloadPath -Destination $TargetPath -Force
  } catch {
    if (Test-Path -LiteralPath $backupPath) {
      Move-Item -LiteralPath $backupPath -Destination $TargetPath -Force
    }
    throw
  }

  Write-UpdateLog "Starting updated app..."
  Start-Process -FilePath $TargetPath -WorkingDirectory $targetDir
  Start-Sleep -Seconds 5
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  Write-UpdateLog 'Update completed.'
  exit 0
} catch {
  Write-UpdateLog ("Update failed: " + $_.Exception.Message)
  if ($backupPath -and (Test-Path -LiteralPath $backupPath) -and -not (Test-Path -LiteralPath $TargetPath)) {
    Move-Item -LiteralPath $backupPath -Destination $TargetPath -Force
  }
  if (Test-Path -LiteralPath $TargetPath) {
    Start-Process -FilePath $TargetPath -WorkingDirectory $targetDir
  }
  exit 1
}
`;
}

function escapeBatchArgument(value) {
  return `"${String(value ?? '').replace(/%/g, '%%').replace(/"/g, '""')}"`;
}

function getUpdaterCommandContent(options) {
  const processId = String(options?.processId || '');
  const targetPath = escapeBatchArgument(options?.targetPath);
  const downloadedPath = escapeBatchArgument(options?.downloadedPath);
  const expectedSha256 = escapeBatchArgument(options?.expectedSha256);

  return `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\necho [%date% %time%] cmd started >> "%~dp0KewuToolboxUpdater.launch.log"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${UPDATER_PS1_NAME}" -ProcessId ${processId} -TargetPath ${targetPath} -DownloadedPath ${downloadedPath} -ExpectedSha256 ${expectedSha256} >> "%~dp0KewuToolboxUpdater.launch.log" 2>&1\r\necho [%date% %time%] powershell exit %errorlevel% >> "%~dp0KewuToolboxUpdater.launch.log"\r\nexit /b %errorlevel%\r\n`;
}

function ensurePortableUpdater(executableDir, options) {
  const ps1Path = path.join(executableDir, UPDATER_PS1_NAME);
  const cmdPath = path.join(executableDir, UPDATER_CMD_NAME);
  const cmdContent = getUpdaterCommandContent(options);
  try {
    fs.writeFileSync(ps1Path, getUpdaterScriptContent(), 'utf8');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');
    return { ok: true, ps1Path, cmdPath };
  } catch (error) {
    return {
      ok: false,
      error: 'write_updater_failed',
      detail: error instanceof Error ? error.message : String(error),
      ps1Path,
      cmdPath,
    };
  }
}

function isTrustedReleaseDownloadUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  return value.startsWith(`${GITHUB_REPO_URL}/releases/download/`);
}

async function startPortableUpdate(payload) {
  if (!app.isPackaged) {
    return { ok: false, error: 'not_packaged' };
  }
  const targetPath = resolveCurrentExecutablePath();
  if (!targetPath) {
    return { ok: false, error: 'missing_target_path' };
  }
  const downloadUrl = typeof payload?.assetUrl === 'string' ? payload.assetUrl.trim() : '';
  const sha256Url = typeof payload?.sha256Url === 'string' ? payload.sha256Url.trim() : '';
  if (!isTrustedReleaseDownloadUrl(downloadUrl) || !isTrustedReleaseDownloadUrl(sha256Url)) {
    return { ok: false, error: 'invalid_update_url' };
  }

  const executableDir = path.dirname(targetPath);
  const targetName = path.basename(targetPath);
  const downloadBaseName = resolveUpdateDownloadBaseName(payload?.assetName, targetName);
  const downloadPath = path.join(executableDir, `${downloadBaseName}.download`);
  const shaPath = path.join(executableDir, `${downloadBaseName}.sha256.download`);

  try {
    fs.rmSync(downloadPath, { force: true });
    fs.rmSync(shaPath, { force: true });
  } catch {
    // Stale temporary files are best-effort cleanup only.
  }

  emitUpdateProgress({
    phase: 'preparing',
    status: 'running',
    percent: 0,
    message: 'Preparing update download...',
  });

  try {
    await downloadUpdateFile(downloadUrl, downloadPath, {
      phase: 'downloading-package',
      message: 'Downloading update package...',
    });
  } catch (error) {
    addDiagnosticLog('error', 'Update package download failed', error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: 'download_update_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await downloadUpdateFile(sha256Url, shaPath, {
      phase: 'downloading-sha256',
      message: 'Downloading sha256 file...',
    });
  } catch (error) {
    addDiagnosticLog('error', 'Update sha256 download failed', error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: 'download_sha256_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let expectedSha256 = '';
  try {
    emitUpdateProgress({
      phase: 'verifying',
      status: 'running',
      percent: 0,
      message: 'Verifying update package...',
    });
    expectedSha256 = parseSha256Content(fs.readFileSync(shaPath, 'utf8'));
    const actualSha256 = await getFileSha256Hex(downloadPath);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`SHA256 mismatch. Expected=${expectedSha256} Actual=${actualSha256}`);
    }
    emitUpdateProgress({
      phase: 'verifying',
      status: 'success',
      percent: 100,
      message: 'Update package verified.',
    });
  } catch (error) {
    addDiagnosticLog('error', 'Update package verification failed', error instanceof Error ? error.message : String(error));
    try {
      fs.rmSync(downloadPath, { force: true });
    } catch {
      // Ignore cleanup failure.
    }
    return {
      ok: false,
      error: 'checksum_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      fs.rmSync(shaPath, { force: true });
    } catch {
      // Ignore cleanup failure.
    }
  }

  const updater = ensurePortableUpdater(executableDir, {
    processId: process.pid,
    targetPath,
    downloadedPath: downloadPath,
    expectedSha256,
  });
  if (!updater.ok) {
    return updater;
  }

  try {
    persistState();
  } catch {
    // Continue update even if a final state write fails.
  }

  emitUpdateProgress({
    phase: 'launching-updater',
    status: 'running',
    percent: 100,
    message: 'Launching updater to replace executable...',
  });

  try {
    const child = childProcess.spawn(
      'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        updater.cmdPath,
      ],
      {
        cwd: executableDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.once('error', error => {
      addDiagnosticLog('error', 'Launch updater failed', error instanceof Error ? error.message : String(error));
      scheduleSave();
    });
    child.unref();
  } catch (error) {
    addDiagnosticLog('error', 'Launch updater failed', error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: 'launch_updater_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  emitUpdateProgress({
    phase: 'ready-to-replace',
    status: 'success',
    percent: 100,
    message: 'Update is ready. Closing app for replacement...',
  });

  setTimeout(() => {
    forceQuitRequested = true;
    app.quit();
  }, 600);

  return {
    ok: true,
    targetPath,
    updaterPath: updater.ps1Path,
    downloadedPath: downloadPath,
    expectedSha256,
  };
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => {
    syncStorageMetaToState();
    return appState;
  });
  ipcMain.handle('app:get-app-version', () => app.getVersion());
  ipcMain.handle('app:check-for-updates', () => checkForPortableUpdate());
  ipcMain.handle('app:start-portable-update', (_event, payload) => startPortableUpdate(payload));
  ipcMain.handle('app:open-external-url', async (_event, payload) => {
    const targetUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!targetUrl) {
      return { ok: false, error: 'invalid_url' };
    }
    try {
      await shell.openExternal(targetUrl);
      return { ok: true };
    } catch {
      return { ok: false, error: 'open_failed' };
    }
  });
  ipcMain.handle('app:get-data-file-path', () => getStatePath());
  ipcMain.handle('app:get-storage-status', () => getStorageStatus());
  ipcMain.handle('app:migrate-legacy-json-storage', () => migrateLegacyJsonStorageToSqlite());
  ipcMain.handle('app:set-data-file-path', (_event, payload) =>
    setDataFilePath(payload?.targetPath, Boolean(payload?.createIfMissing)),
  );
  ipcMain.handle('app:select-data-file-path', async () => {
    const currentPath = getStatePath();
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择数据目录',
      defaultPath: currentPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle('app:save-user-state', (_event, partial) => {
    mergeUserStateFromRenderer(partial);
    scheduleSave();
    emitState();
    return { ok: true };
  });
  ipcMain.handle('app:merge-records-by-whitelist', () => mergeRecordsByCurrentWhitelist());
  ipcMain.handle('app:clear-all-data', () => clearAllData());
  ipcMain.handle('app:clear-diagnostic-logs', () => {
    appState.diagnosticLogs = [];
    try {
      const logFilePath = getLogFilePath();
      ensureWritableLogFile(logFilePath);
      fs.writeFileSync(logFilePath, '', 'utf8');
    } catch {
      // Ignore clear-log file failures.
    }
    scheduleSave();
    emitState();
    return { ok: true };
  });
  ipcMain.handle('app:notify', (_event, payload) => notifySystem(payload));
  ipcMain.handle('app:hide-to-tray', () => ({ ok: hideMainWindowToTray() }));
  ipcMain.handle('app:select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择提示音文件',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle('clipboard:get-current', () => {
    const snapshot = readClipboardSnapshot();
    pushClipboardHistory(snapshot, 'renderer-current');
    return snapshot;
  });
  ipcMain.handle('clipboard:get-history', () => getClipboardHistoryForRenderer());
  ipcMain.handle('clipboard:write-item', (_event, payload) => writeClipboardItem(payload));
}

function safeClipboardFormats() {
  try {
    return clipboard.availableFormats();
  } catch {
    return [];
  }
}

function inferImageMime(dataUrl) {
  const match = /^data:image\/([^;,]+)/i.exec(dataUrl || '');
  return match ? match[1].toLowerCase() : 'png';
}

function hashClipboardPayload(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function createOtherClipboardSnapshot(formats, capturedAt) {
  return {
    id: `clip-${capturedAt}-${hashClipboardPayload(formats.join('|')).slice(0, 10)}`,
    kind: 'other',
    capturedAt: new Date(capturedAt).toISOString(),
    formats,
    title: formats.length > 0 ? `${formats.length} 种剪贴板格式` : '空剪贴板',
    details: formats.map(format => ({ name: format })),
  };
}

function readClipboardSnapshot() {
  const capturedAt = Date.now();
  const formats = safeClipboardFormats();

  try {
    const image = clipboard.readImage();
    if (image && !image.isEmpty()) {
      const size = image.getSize();
      const dataUrl = image.toDataURL();
      const imageType = inferImageMime(dataUrl);
      return {
        id: `clip-${capturedAt}-${hashClipboardPayload(`${size.width}x${size.height}:${dataUrl.slice(0, 256)}:${dataUrl.length}`).slice(0, 10)}`,
        kind: 'image',
        capturedAt: new Date(capturedAt).toISOString(),
        formats,
        title: `${size.width} × ${size.height} ${imageType.toUpperCase()}`,
        image: {
          dataUrl,
          width: size.width,
          height: size.height,
          type: imageType,
          byteLength: Math.max(0, Math.floor((dataUrl.length * 3) / 4)),
        },
      };
    }
  } catch (error) {
    addDiagnosticLog('warn', '读取剪贴板图片失败', error?.message || String(error));
  }

  try {
    const text = clipboard.readText();
    if (typeof text === 'string' && text.length > 0) {
      return {
        id: `clip-${capturedAt}-${hashClipboardPayload(text).slice(0, 10)}`,
        kind: 'text',
        capturedAt: new Date(capturedAt).toISOString(),
        formats,
        title: text.slice(0, 80).replace(/\s+/g, ' ') || '文本',
        text,
      };
    }
  } catch (error) {
    addDiagnosticLog('warn', '读取剪贴板文本失败', error?.message || String(error));
  }

  return createOtherClipboardSnapshot(formats, capturedAt);
}

function getClipboardSignature(snapshot) {
  if (!snapshot) {
    return '';
  }
  if (snapshot.kind === 'text') {
    return `text:${hashClipboardPayload(snapshot.text || '')}`;
  }
  if (snapshot.kind === 'image') {
    return `image:${snapshot.image?.width || 0}x${snapshot.image?.height || 0}:${hashClipboardPayload(snapshot.image?.dataUrl || '')}`;
  }
  return `other:${hashClipboardPayload((snapshot.formats || []).join('|'))}`;
}

function markClipboardWriteByApp(signature) {
  lastAppClipboardWriteSignature = signature || '';
  lastAppClipboardWriteAtMs = Date.now();
}

function shouldIgnoreClipboardWriteByApp(signature) {
  if (!signature || !lastAppClipboardWriteSignature) {
    return false;
  }
  const elapsedMs = Date.now() - lastAppClipboardWriteAtMs;
  if (signature !== lastAppClipboardWriteSignature || elapsedMs > CLIPBOARD_OWN_WRITE_IGNORE_MS) {
    return false;
  }
  lastAppClipboardWriteSignature = '';
  lastAppClipboardWriteAtMs = 0;
  return true;
}

function emitClipboardChanged(snapshot) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    mainWindow.webContents.send('clipboard:changed', {
      current: snapshot,
      history: getClipboardHistoryForRenderer(),
    });
  } catch {
    // Ignore renderer update failures.
  }
}

function pushClipboardHistory(snapshot, source = 'unknown') {
  if (!snapshot) {
    return false;
  }
  if (snapshot.kind === 'other' && (!Array.isArray(snapshot.formats) || snapshot.formats.length === 0)) {
    return false;
  }
  const signature = getClipboardSignature(snapshot);
  if (!signature || signature === lastClipboardSignature) {
    return false;
  }
  lastClipboardSignature = signature;
  if (shouldIgnoreClipboardWriteByApp(signature)) {
    addDiagnosticLog('debug', 'Clipboard change ignored because it was written by KewuToolbox', source);
    emitClipboardChanged(snapshot);
    return false;
  }

  try {
    getSqliteStateStore(getStatePath()).saveClipboardSnapshot(snapshot, signature, CLIPBOARD_HISTORY_LIMIT);
  } catch (error) {
    addDiagnosticLog('error', 'Failed to persist clipboard history', error?.message || String(error));
    return false;
  }

  emitClipboardChanged(snapshot);
  return true;
}

function getClipboardHistoryForRenderer() {
  let history = [];
  try {
    history = getSqliteStateStore(getStatePath()).getClipboardHistory(CLIPBOARD_HISTORY_LIMIT);
  } catch (error) {
    addDiagnosticLog('error', 'Failed to read clipboard history', error?.message || String(error));
    return [];
  }

  return history.map(item => {
    if (item.kind !== 'image') {
      return item;
    }
    return {
      ...item,
      image: {
        ...item.image,
        dataUrl: item.image?.dataUrl || '',
      },
    };
  });
}

function captureClipboardNow(source = 'unknown') {
  try {
    return pushClipboardHistory(readClipboardSnapshot(), source);
  } catch (error) {
    addDiagnosticLog('warn', 'Clipboard capture failed', error?.message || String(error));
    return false;
  }
}

function getClipboardListenerExecutablePath() {
  if (process.platform !== 'win32') {
    return null;
  }

  const candidates = [
    path.join(process.resourcesPath || '', 'native', 'kewu-clipboard-listener.exe'),
    path.join(__dirname, '..', 'native', 'clipboard-listener', 'target', 'release', 'kewu-clipboard-listener.exe'),
    path.join(__dirname, 'native', 'kewu-clipboard-listener.exe'),
  ];

  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function handleClipboardListenerLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    addDiagnosticLog('debug', 'Clipboard listener output', trimmed);
    return;
  }

  if (payload.event === 'ready') {
    addDiagnosticLog('info', 'Native clipboard listener started');
    return;
  }

  if (payload.event === 'clipboard-update') {
    setTimeout(() => captureClipboardNow('native-event'), 30);
    return;
  }

  if (payload.event === 'error') {
    addDiagnosticLog('warn', 'Native clipboard listener error', payload.message || '');
  }
}

function handleClipboardListenerStdout(chunk) {
  clipboardListenerStdoutBuffer += chunk.toString('utf8');
  const lines = clipboardListenerStdoutBuffer.split(/\r?\n/);
  clipboardListenerStdoutBuffer = lines.pop() || '';
  for (const line of lines) {
    handleClipboardListenerLine(line);
  }
}

function startClipboardPollingFallback(reason) {
  if (clipboardTimer) {
    return;
  }
  addDiagnosticLog('warn', 'Using clipboard polling fallback', reason || '');
  clipboardTimer = setInterval(() => captureClipboardNow('polling-fallback'), CLIPBOARD_POLL_INTERVAL_MS);
}

function startNativeClipboardListener() {
  if (clipboardListenerProcess) {
    return true;
  }

  const executablePath = getClipboardListenerExecutablePath();
  if (!executablePath) {
    return false;
  }

  try {
    clipboardListenerProcess = childProcess.spawn(executablePath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    addDiagnosticLog('warn', 'Failed to start native clipboard listener', error?.message || String(error));
    clipboardListenerProcess = null;
    return false;
  }

  clipboardListenerStdoutBuffer = '';
  clipboardListenerProcess.stdout?.on('data', handleClipboardListenerStdout);
  clipboardListenerProcess.stderr?.on('data', chunk => {
    const message = chunk.toString('utf8').trim();
    if (message) {
      addDiagnosticLog('warn', 'Native clipboard listener stderr', message);
    }
  });
  clipboardListenerProcess.on('error', error => {
    addDiagnosticLog('warn', 'Native clipboard listener process error', error?.message || String(error));
    clipboardListenerProcess = null;
    if (!isStoppingClipboardMonitoring && !forceQuitRequested) {
      startClipboardPollingFallback('native-listener-error');
    }
  });
  clipboardListenerProcess.on('exit', (code, signal) => {
    const wasStopping = isStoppingClipboardMonitoring || forceQuitRequested;
    clipboardListenerProcess = null;
    if (!wasStopping) {
      addDiagnosticLog('warn', 'Native clipboard listener exited', `code=${code ?? ''} signal=${signal ?? ''}`);
      startClipboardPollingFallback('native-listener-exit');
    }
  });

  return true;
}

function stopClipboardMonitoring() {
  isStoppingClipboardMonitoring = true;
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
  if (clipboardListenerProcess) {
    const processToStop = clipboardListenerProcess;
    clipboardListenerProcess = null;
    try {
      processToStop.removeAllListeners('exit');
      processToStop.removeAllListeners('error');
      processToStop.kill();
    } catch {
      // Ignore helper termination failures.
    }
  }
  clipboardListenerStdoutBuffer = '';
  setTimeout(() => {
    isStoppingClipboardMonitoring = false;
  }, 100);
}

function startClipboardMonitoring() {
  stopClipboardMonitoring();
  captureClipboardNow('startup');
  if (!startNativeClipboardListener()) {
    startClipboardPollingFallback('native-listener-unavailable');
  }
}

function writeClipboardItem(payload) {
  const kind = payload?.kind;
  try {
    if (kind === 'text') {
      const text = typeof payload?.text === 'string' ? payload.text : '';
      clipboard.writeText(text);
      const snapshot = readClipboardSnapshot();
      markClipboardWriteByApp(getClipboardSignature(snapshot));
      emitClipboardChanged(snapshot);
      return { ok: true };
    }

    if (kind === 'image') {
      const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : '';
      if (!dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'invalid_image' };
      }
      const image = nativeImage.createFromDataURL(dataUrl);
      if (!image || image.isEmpty()) {
        return { ok: false, error: 'invalid_image' };
      }
      clipboard.writeImage(image);
      const snapshot = readClipboardSnapshot();
      markClipboardWriteByApp(getClipboardSignature(snapshot));
      emitClipboardChanged(snapshot);
      return { ok: true };
    }

    return { ok: false, error: 'unsupported_kind' };
  } catch (error) {
    addDiagnosticLog('error', 'Failed to write clipboard item', error?.message || String(error));
    return { ok: false, error: 'write_failed', detail: error?.message || String(error) };
  }
}

function registerPowerEvents() {
  powerMonitor.on('suspend', () => addPowerEvent('挂起', '系统挂起', '#a855f7'));
  powerMonitor.on('resume', () => addPowerEvent('恢复', '系统恢复', '#06b6d4'));
  powerMonitor.on('lock-screen', () => addPowerEvent('锁屏', '用户锁定', '#f59e0b'));
  powerMonitor.on('unlock-screen', () => addPowerEvent('解锁', '用户解锁', '#3b82f6'));
  powerMonitor.on('shutdown', () => addPowerEvent('关机', '系统关机', '#ef4444'));
}

async function handleWindowClose(event) {
  if (forceQuitRequested || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const closeBehavior = normalizeCloseWindowBehavior(appState.preferences?.closeWindowBehavior, 'ask');
  if (closeBehavior === 'close') {
    return;
  }

  event.preventDefault();

  if (closeBehavior === 'tray') {
    const hidden = hideMainWindowToTray();
    if (!hidden) {
      forceQuitRequested = true;
      mainWindow.close();
    }
    return;
  }

  if (isHandlingCloseDecision) {
    return;
  }
  isHandlingCloseDecision = true;

  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Close App',
      message: 'What should happen when closing the window?',
      detail: 'You can change the default behavior in Settings > General.',
      buttons: ['Close App', 'Hide to Tray', 'Cancel'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
      checkboxLabel: 'Remember my choice (do not ask again)',
      checkboxChecked: false,
    });

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (result.response === 2) {
      return;
    }

    const chosenBehavior = result.response === 0 ? 'close' : 'tray';

    if (result.checkboxChecked) {
      appState.preferences = {
        ...appState.preferences,
        closeWindowBehavior: chosenBehavior,
      };
      scheduleSave();
      emitState();
    }

    if (chosenBehavior === 'tray') {
      const hidden = hideMainWindowToTray();
      if (!hidden) {
        forceQuitRequested = true;
        mainWindow.close();
      }
      return;
    }

    forceQuitRequested = true;
    mainWindow.close();
  } finally {
    isHandlingCloseDecision = false;
  }
}

function createWindow(options = {}) {
  forceQuitRequested = false;
  isHandlingCloseDecision = false;
  const startHiddenToTray = Boolean(options.startHiddenToTray);
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111827',
    icon: iconPath,
    show: !startHiddenToTray,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:8080';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (startHiddenToTray) {
    createTray();
    try {
      mainWindow.setSkipTaskbar(true);
    } catch {
      // Ignore skip-taskbar errors.
    }
    setWindowHiddenToTray(true);
  } else {
    setWindowHiddenToTray(false);
  }
  mainWindow.on('close', event => {
    void handleWindowClose(event);
  });

  mainWindow.on('closed', () => {
    setWindowHiddenToTray(false);
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  loadStorageConfig();
  await initializeSqliteEngine();
  loadPersistedState();
  syncStorageMetaToState();
  setupConsoleCapture();
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(
    appState.preferences.autoLaunchEnabled,
  );
  addDiagnosticLog('info', '应用启动', getStatePath());
  registerIpc();
  registerPowerEvents();
  startBrowserBridgeServer();
  createWindow({ startHiddenToTray: shouldStartHiddenToTray() });
  createTray();
  addPowerEvent('开机', '应用启动并开始监测', '#22c55e');
  startMonitoring();
  startInputActivityMonitoring();
  startClipboardMonitoring();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    showMainWindowFromTray();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  forceQuitRequested = true;
  finalizeAllOpenProcessTimelines();
  stopMonitoring();
  stopInputActivityMonitoring();
  stopBrowserBridgeServer();
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (inputActivityFlushTimer) {
    clearTimeout(inputActivityFlushTimer);
    inputActivityFlushTimer = null;
  }
  stopClipboardMonitoring();
  persistState();
});

