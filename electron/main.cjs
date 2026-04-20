const { app, BrowserWindow, dialog, ipcMain, powerMonitor, Notification, Tray, Menu, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const POLL_INTERVAL_MS = 1000;
const MAX_SESSIONS = 60000;
const MAX_POWER_EVENTS = 5000;
const DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS = 60;

const DESKTOP_KEY = 'desktop';
const BROWSER_DOMAIN_KEY_PREFIX = 'browser-domain';
const PROCESS_WHITELIST_KEY_PREFIX = 'process-whitelist';
const DEFAULT_CATEGORY = '其他';
const DESKTOP_CATEGORY = '休息';
const DEFAULT_DISPLAY_MODE = '显示性质';
const BUILTIN_COMPLETION_SOUND_ID = 'builtin-completion';
const BUILTIN_WARNING_SOUND_ID = 'builtin-warning';

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
const STATE_FILE_NAME = 'app-state.json';
const STORAGE_CONFIG_FILE_NAME = 'storage-config.json';
const PACKAGED_RUNTIME_DIR_NAME = 'electron-runtime';
const CODE_WINDOW_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let monitorTimer = null;
let saveTimer = null;
let activeWinApi = null;
let browserBridgeServer = null;
let resolvedStatePath = null;
let preferredStatePath = null;
let appTray = null;
let forceQuitRequested = false;
let isHandlingCloseDecision = false;

/** @type {import('../src/types').AppState} */
let appState = createEmptyState();

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
  /** @type {Map<string, {pluginId: string, pluginName: string, pluginVersion: string, protocolVersion?: string, homepageUrl?: string, source?: string, isOfficial?: boolean, records: any[], suppressRules: any[], focusedClassificationKey: string | null, connectedAt: string, updatedAtMs: number, updatedAtIso: string}>} */
  byPlugin: new Map(),
};

const pendingWindowRuntime = new Map();
const codeWindowIdentityCache = new Map();

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
    currentProcessKeys: [],
    processTags: [],
    processTagAssignments: [],
    processTagStats: [],
    soundFiles: createDefaultSoundFiles(),
    preferences: {
      recordWindowThresholdSeconds: DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS,
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

function resolveStatePathInput(inputPath) {
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

  const looksLikeDirectory =
    candidate.endsWith(path.sep) ||
    candidate.endsWith('/') ||
    candidate.endsWith('\\') ||
    path.extname(candidate).trim() === '';
  return looksLikeDirectory ? path.join(candidate, STATE_FILE_NAME) : candidate;
}

configurePackagedRuntimePaths();

function getDefaultStatePath() {
  if (!app.isPackaged) {
    return path.join(app.getPath('userData'), STATE_FILE_NAME);
  }

  return path.join(getPackagedDataDir(), STATE_FILE_NAME);
}

function loadStorageConfig() {
  const config = readJsonSafe(getStorageConfigPath());
  const configuredPath = resolveStatePathInput(config?.stateFilePath);
  preferredStatePath = configuredPath;
  return configuredPath;
}

function persistStorageConfig() {
  const payload = {
    stateFilePath: preferredStatePath || '',
    updatedAt: new Date().toISOString(),
  };
  writeJsonSafe(getStorageConfigPath(), payload);
}

function getStatePath() {
  if (resolvedStatePath) {
    return resolvedStatePath;
  }

  resolvedStatePath = preferredStatePath || getDefaultStatePath();
  return resolvedStatePath;
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

function ensureWritableStatePath(targetPath) {
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const probePath = path.join(dir, '.write-probe');
    fs.writeFileSync(probePath, 'ok', 'utf8');
    fs.unlinkSync(probePath);
    return targetPath;
  } catch {
    return null;
  }
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

function readSystemAutoLaunchEnabled() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return false;
  }
}

function applySystemAutoLaunchEnabled(enabled) {
  const normalized = Boolean(enabled);
  try {
    app.setLoginItemSettings({
      openAtLogin: normalized,
      path: process.execPath,
      args: [],
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

function readJsonWithStatus(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, data: null, error: null };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { exists: true, data: JSON.parse(content), error: null };
  } catch (error) {
    return { exists: true, data: null, error };
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
    pushNameValue(`http://${profile.domain}`);
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

function persistState() {
  const primaryPath = getStatePath();
  if (writeJsonSafe(primaryPath, appState)) {
    return;
  }

  if (app.isPackaged) {
    return;
  }

  const fallbackPath = path.join(app.getPath('userData'), STATE_FILE_NAME);
  if (fallbackPath !== primaryPath && writeJsonSafe(fallbackPath, appState)) {
    applyStatePath(fallbackPath);
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
    currentProcessKeys: Array.isArray(raw.currentProcessKeys) ? raw.currentProcessKeys : [],
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
  const primaryPath = getStatePath();
  let saved = readJsonSafe(primaryPath);

  if (!saved && !preferredStatePath && !app.isPackaged) {
    const fallbackPath = path.join(app.getPath('userData'), STATE_FILE_NAME);
    if (fallbackPath !== primaryPath) {
      saved = readJsonSafe(fallbackPath);
      if (saved) {
        writeJsonSafe(primaryPath, saved);
      }
    }
  }

  appState = normalizeSavedState(saved);
  applyWhitelistNamesToState();
}

function applyStatePath(newPath) {
  preferredStatePath = newPath;
  resolvedStatePath = newPath;
  persistStorageConfig();
}

function setDataFilePath(targetPath, createIfMissing = false) {
  const normalizedPath = resolveStatePathInput(targetPath);
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' };
  }

  const exists = fs.existsSync(normalizedPath);
  if (!exists && !createIfMissing) {
    return { ok: false, requiresCreate: true, path: normalizedPath };
  }

  if (!ensureWritableStatePath(normalizedPath)) {
    return { ok: false, error: 'path_not_writable', path: normalizedPath };
  }

  const jsonState = readJsonWithStatus(normalizedPath);
  if (jsonState.exists && jsonState.error) {
    return { ok: false, error: 'invalid_json', path: normalizedPath };
  }

  let nextState = createEmptyState();
  let created = false;
  if (jsonState.exists && jsonState.data) {
    nextState = normalizeSavedState(jsonState.data);
  } else if (jsonState.exists && !jsonState.data) {
    return { ok: false, error: 'invalid_json', path: normalizedPath };
  } else {
    created = true;
    if (!writeJsonSafe(normalizedPath, nextState)) {
      return { ok: false, error: 'create_failed', path: normalizedPath };
    }
  }

  applyStatePath(normalizedPath);
  appState = nextState;
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(appState.preferences.autoLaunchEnabled);
  resetRuntimeTrackingState();
  scheduleSave();
  emitState();

  return {
    ok: true,
    path: normalizedPath,
    existed: !created,
    created,
    state: appState,
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
  browserBridgeState.byBrowser.clear();
  pluginBridgeState.byPlugin.clear();
  codeWindowIdentityCache.clear();
  syncPluginConnectionsToState([]);
}

function clearAllData() {
  appState = createEmptyState();
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

function updateProcessTagStats(openKeys, focusedKey, deltaSeconds, nowIso, focusedTagStreakSeconds = 0) {
  if (deltaSeconds <= 0) {
    return;
  }

  const assignmentMap = getProcessTagAssignmentMap();
  const visibleTagSet = new Set();

  for (const classificationKey of openKeys) {
    const assignment = assignmentMap.get(classificationKey);
    if (!assignment) {
      continue;
    }
    visibleTagSet.add(assignment.tagId);
  }

  const focusedTagId = focusedKey ? assignmentMap.get(focusedKey)?.tagId : undefined;
  const statMap = new Map(appState.processTagStats.map(item => [item.tagId, item]));

  for (const tagId of visibleTagSet) {
    const existing = statMap.get(tagId);
    if (existing) {
      existing.totalVisibleSeconds += deltaSeconds;
    } else {
      statMap.set(tagId, {
        tagId,
        totalVisibleSeconds: deltaSeconds,
        focusSeconds: 0,
        lastFocusAt: '',
        longestContinuousFocusSeconds: 0,
      });
    }
  }

  if (focusedTagId) {
    const focusedStat = statMap.get(focusedTagId);
    if (focusedStat) {
      focusedStat.focusSeconds += deltaSeconds;
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

function upsertActiveSession(profile, nowIso) {
  if (monitorCursor.activeSessionId && monitorCursor.activeClassificationKey === profile.classificationKey) {
    appState.sessions = appState.sessions.map(session => {
      if (session.id !== monitorCursor.activeSessionId) {
        return session;
      }
      const durationSeconds = Math.max(1, Math.floor((new Date(nowIso).getTime() - new Date(session.startAt).getTime()) / 1000));
      return {
        ...session,
        endAt: nowIso,
        durationSeconds,
      };
    });
    return;
  }

  monitorCursor.activeSessionId = makeId('session');
  monitorCursor.activeClassificationKey = profile.classificationKey;

  appState.sessions.push({
    id: monitorCursor.activeSessionId,
    startAt: nowIso,
    endAt: nowIso,
    durationSeconds: 1,
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
  const explicitKey = typeof record.classificationKey === 'string' ? record.classificationKey.trim() : '';
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
  const focusedClassificationKey =
    typeof snapshot.focusedClassificationKey === 'string' && snapshot.focusedClassificationKey.trim()
      ? snapshot.focusedClassificationKey.trim()
      : null;

  const nowIso = new Date().toISOString();
  const existing = pluginBridgeState.byPlugin.get(pluginId);
  return {
    pluginId,
    pluginName,
    pluginVersion,
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
    connectedAt: existing?.connectedAt || nowIso,
    updatedAtIso: nowIso,
    updatedAtMs: Date.now(),
  };
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

function getFocusedProfileFromPlugins(activeSnapshots) {
  let selected = null;
  for (const snapshot of activeSnapshots) {
    if (!snapshot || !snapshot.focusedClassificationKey) {
      continue;
    }
    const record = (snapshot.records || []).find(
      item => item && item.classificationKey === snapshot.focusedClassificationKey,
    );
    if (!record) {
      continue;
    }
    if (!selected || snapshot.updatedAtMs > selected.updatedAtMs) {
      selected = {
        updatedAtMs: snapshot.updatedAtMs,
        profile: {
          ...record,
          id: makeId('profile'),
          updatedAt: new Date().toISOString(),
        },
      };
    }
  }
  return selected?.profile ?? null;
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
  const [focusedRaw, openWindows] = await Promise.all([activeWin(), activeWin.getOpenWindows()]);
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
  if (!focusedCandidate) {
    focusedCandidate = getFocusedProfileFromPlugins(activePluginSnapshots);
  }
  const focusedCandidates = focusedCandidate
    ? applyProcessWhitelistToProfile(focusedCandidate).filter(profile => !shouldIgnoreByBlacklist(profile))
    : [];
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

  const recordedKeys = new Set(appState.windowStats.map(item => item.classificationKey));
  const openKeys = new Set(bucket.keys());
  const recordThresholdSeconds = normalizeRecordWindowThresholdSeconds(
    appState.preferences?.recordWindowThresholdSeconds,
    DEFAULT_RECORD_WINDOW_THRESHOLD_SECONDS,
  );

  for (const [key, candidate] of bucket.entries()) {
    const isFocusedWindow = focusedKeySet.has(key);
    const focusDelta = isFocusedWindow ? deltaSeconds : 0;
    const profile = ensureProfile(candidate);
    const existingPending = pendingWindowRuntime.get(key);
    const pending = existingPending ?? {
      totalVisibleSeconds: 0,
      totalFocusSeconds: 0,
      currentContinuousFocusSeconds: 0,
      longestContinuousFocusSeconds: 0,
      lastFocusAt: '',
      recorded: recordedKeys.has(key),
    };
    pending.totalVisibleSeconds += deltaSeconds;
    pending.totalFocusSeconds += focusDelta;
    if (focusDelta > 0) {
      pending.currentContinuousFocusSeconds += focusDelta;
      pending.longestContinuousFocusSeconds = Math.max(
        pending.longestContinuousFocusSeconds,
        pending.currentContinuousFocusSeconds,
      );
      pending.lastFocusAt = nowIso;
    } else {
      pending.currentContinuousFocusSeconds = 0;
    }

    const isRecordEligible = pending.recorded || pending.totalVisibleSeconds >= recordThresholdSeconds;
    if (isRecordEligible) {
      const visibleDelta = pending.recorded ? deltaSeconds : pending.totalVisibleSeconds;
      const focusDeltaToApply = pending.recorded ? focusDelta : pending.totalFocusSeconds;
      upsertWindowStat(profile, visibleDelta, focusDeltaToApply, {
        lastFocusAt: pending.lastFocusAt,
        longestContinuousFocusSeconds: pending.longestContinuousFocusSeconds,
      });
      pending.recorded = true;
      if (isFocusedWindow && primaryFocusedCandidate && key === primaryFocusedCandidate.classificationKey) {
        focusedProfile = profile;
        currentFocusedWindow = profile;
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
      pendingWindowRuntime.delete(key);
    }
  }

  appState.currentProcessKeys = [...bucket.keys()];
  appState.currentFocusedWindow = currentFocusedWindow;

  const assignmentMap = getProcessTagAssignmentMap();
  const focusedTagId = focusedProfile ? assignmentMap.get(focusedProfile.classificationKey)?.tagId ?? null : null;
  if (deltaSeconds > 0) {
    if (focusedTagId) {
      if (monitorCursor.activeTagId === focusedTagId) {
        monitorCursor.tagFocusStreakSeconds += deltaSeconds;
      } else {
        monitorCursor.activeTagId = focusedTagId;
        monitorCursor.tagFocusStreakSeconds = deltaSeconds;
      }
    } else {
      monitorCursor.activeTagId = null;
      monitorCursor.tagFocusStreakSeconds = 0;
    }
  }
  updateProcessTagStats(
    new Set(appState.currentProcessKeys),
    focusedProfile?.classificationKey,
    deltaSeconds,
    nowIso,
    monitorCursor.tagFocusStreakSeconds,
  );

  if (focusedProfile && deltaSeconds > 0) {
    upsertActiveSession(focusedProfile, nowIso);
  } else if (!focusedProfile) {
    monitorCursor.activeSessionId = null;
    monitorCursor.activeClassificationKey = null;
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
    monitorTick().catch(() => {
      // Ignore single-tick failure.
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
    appState.currentProcessKeys = appState.currentProcessKeys.filter(key => incomingKeySet.has(key));
    appState.processTagAssignments = appState.processTagAssignments.filter(
      assignment =>
        validTagSet.has(assignment.tagId) && incomingKeySet.has(assignment.classificationKey),
    );

    for (const key of [...pendingWindowRuntime.keys()]) {
      if (!incomingKeySet.has(key)) {
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

function registerIpc() {
  ipcMain.handle('app:get-state', () => appState);
  ipcMain.handle('app:get-app-version', () => app.getVersion());
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
  ipcMain.handle('app:set-data-file-path', (_event, payload) =>
    setDataFilePath(payload?.targetPath, Boolean(payload?.createIfMissing)),
  );
  ipcMain.handle('app:select-data-file-path', async () => {
    const currentPath = getStatePath();
    const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: '选择数据文件路径',
      defaultPath: currentPath,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  });
  ipcMain.handle('app:save-user-state', (_event, partial) => {
    mergeUserStateFromRenderer(partial);
    scheduleSave();
    emitState();
    return { ok: true };
  });
  ipcMain.handle('app:clear-all-data', () => clearAllData());
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

function createWindow() {
  forceQuitRequested = false;
  isHandlingCloseDecision = false;
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111827',
    icon: iconPath,
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

  setWindowHiddenToTray(false);
  mainWindow.on('close', event => {
    void handleWindowClose(event);
  });

  mainWindow.on('closed', () => {
    setWindowHiddenToTray(false);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  loadStorageConfig();
  loadPersistedState();
  appState.preferences.autoLaunchEnabled = applySystemAutoLaunchEnabled(
    appState.preferences.autoLaunchEnabled,
  );
  registerIpc();
  registerPowerEvents();
  startBrowserBridgeServer();
  createWindow();
  createTray();
  addPowerEvent('开机', '应用启动并开始监测', '#22c55e');
  startMonitoring();

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
  stopMonitoring();
  stopBrowserBridgeServer();
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistState();
});

