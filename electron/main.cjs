const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const POLL_INTERVAL_MS = 1000;
const MAX_SESSIONS = 60000;
const MAX_POWER_EVENTS = 5000;
const DESKTOP_KEY = 'desktop';
const DEFAULT_CATEGORY = '其他';
const DESKTOP_CATEGORY = '休息';

let mainWindow = null;
let monitorTimer = null;
let saveTimer = null;
let activeWinApi = null;

/** @type {import('../src/types').AppState} */
let appState = createEmptyState();
let monitorCursor = {
  lastTickAt: null,
  activeSessionId: null,
  activeSessionStartAt: null,
  activeClassificationKey: null,
};

function createEmptyState() {
  const now = new Date().toISOString();
  return {
    profiles: [],
    sessions: [],
    windowStats: [],
    subjects: [],
    queue: [],
    pomodoroSettings: {
      focusMinutes: 25,
      breakMinutes: 5,
      distractionThresholdMinutes: 1,
      distractionMode: '连续',
      notifyEnabled: true,
      soundEnabled: true,
      cycleCount: 0,
    },
    todos: [],
    archives: [],
    powerEvents: [],
    currentFocusedWindow: null,
    displayMode: '显示性质',
  };
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'app-state.json');
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function categoryFromExistingOrDefault(existingCategory, isDesktop) {
  if (typeof existingCategory === 'string' && existingCategory.trim().length > 0) {
    return existingCategory;
  }

  return isDesktop ? DESKTOP_CATEGORY : DEFAULT_CATEGORY;
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJsonSafe(getStatePath(), appState);
  }, 300);
}

function normalizeSavedState(input) {
  const base = createEmptyState();
  if (!input || typeof input !== 'object') {
    return base;
  }

  const raw = input;
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const normalizedProfiles = rawProfiles
    .filter(profile => profile && typeof profile === 'object' && typeof profile.classificationKey === 'string')
    .map(profile => ({
      id: typeof profile.id === 'string' ? profile.id : makeId('profile'),
      classificationKey: profile.classificationKey,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : profile.classificationKey,
      objectType: profile.objectType === 'BrowserTab' || profile.objectType === 'Desktop' ? profile.objectType : 'AppWindow',
      processName: typeof profile.processName === 'string' ? profile.processName : '',
      browserName: typeof profile.browserName === 'string' ? profile.browserName : undefined,
      normalizedTitle: typeof profile.normalizedTitle === 'string' ? profile.normalizedTitle : profile.classificationKey,
      domain: typeof profile.domain === 'string' ? profile.domain : undefined,
      category: categoryFromExistingOrDefault(profile.category, profile.objectType === 'Desktop'),
      isBuiltIn: Boolean(profile.isBuiltIn),
      updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : new Date().toISOString(),
    }));

  return {
    ...base,
    ...raw,
    profiles: normalizedProfiles,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    windowStats: Array.isArray(raw.windowStats) ? raw.windowStats : [],
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    archives: Array.isArray(raw.archives) ? raw.archives : [],
    powerEvents: Array.isArray(raw.powerEvents) ? raw.powerEvents : [],
    currentFocusedWindow: raw.currentFocusedWindow ?? null,
    displayMode: raw.displayMode === '显示窗口' ? '显示窗口' : '显示性质',
    pomodoroSettings: {
      ...base.pomodoroSettings,
      ...(raw.pomodoroSettings ?? {}),
    },
  };
}

function loadPersistedState() {
  const saved = readJsonSafe(getStatePath());
  appState = normalizeSavedState(saved);
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('monitor:state', appState);
}

function isDesktopWindowTitle(title) {
  const normalized = (title || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === 'program manager' || normalized === 'workerw';
}

function safeParseDomain(maybeUrl) {
  if (!maybeUrl || typeof maybeUrl !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(maybeUrl);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function normalizeProcessName(ownerPath, ownerName) {
  const fromPath = typeof ownerPath === 'string' ? path.basename(ownerPath) : '';
  if (fromPath) {
    return fromPath;
  }
  if (typeof ownerName === 'string' && ownerName.trim().length > 0) {
    return ownerName;
  }
  return 'unknown';
}

function inferObjectType(processName, title, maybeUrl) {
  const lower = processName.toLowerCase();
  const isDesktop =
    lower === 'explorer.exe' &&
    isDesktopWindowTitle(title);
  if (isDesktop) {
    return 'Desktop';
  }

  const browserProcesses = new Set([
    'chrome.exe',
    'msedge.exe',
    'firefox.exe',
    'brave.exe',
    'vivaldi.exe',
    'opera.exe',
  ]);

  if (browserProcesses.has(lower) || typeof maybeUrl === 'string') {
    return 'BrowserTab';
  }

  return 'AppWindow';
}

function buildClassificationKey({ objectType, processName, domain, normalizedTitle }) {
  if (objectType === 'Desktop') {
    return DESKTOP_KEY;
  }
  const titlePart = (normalizedTitle || '').trim().toLowerCase();
  const domainPart = (domain || '').trim().toLowerCase();
  return [objectType, processName.toLowerCase(), domainPart, titlePart]
    .filter(Boolean)
    .join('|')
    .slice(0, 300);
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
  const normalizedTitle = (rawWindow.title || '').trim() || processName;
  const domain = safeParseDomain(rawWindow.url);
  const objectType = inferObjectType(processName, normalizedTitle, rawWindow.url);
  const browserName = rawWindow.owner?.name || undefined;
  const displayName = objectType === 'BrowserTab'
    ? normalizedTitle
    : normalizedTitle;
  const classificationKey = buildClassificationKey({
    objectType,
    processName,
    domain,
    normalizedTitle,
  });

  return {
    id: makeId('profile'),
    classificationKey,
    displayName,
    objectType,
    processName,
    browserName,
    normalizedTitle,
    domain,
    category: objectType === 'Desktop' ? DESKTOP_CATEGORY : DEFAULT_CATEGORY,
    isBuiltIn: objectType === 'Desktop',
    updatedAt: new Date().toISOString(),
  };
}

function ensureProfile(profileCandidate) {
  const existing = appState.profiles.find(p => p.classificationKey === profileCandidate.classificationKey);
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
    appState.profiles = appState.profiles.map(p => (p.classificationKey === merged.classificationKey ? merged : p));
    return merged;
  }

  const toInsert = {
    ...profileCandidate,
    category: categoryFromExistingOrDefault(profileCandidate.category, profileCandidate.objectType === 'Desktop'),
  };
  appState.profiles = [...appState.profiles, toInsert];
  return toInsert;
}

function upsertWindowStat(profile, deltaSeconds, focusDeltaSeconds, seenAt) {
  const existing = appState.windowStats.find(item => item.classificationKey === profile.classificationKey);
  if (existing) {
    existing.displayName = profile.displayName;
    existing.objectType = profile.objectType;
    existing.processName = profile.processName;
    existing.domain = profile.domain;
    existing.category = profile.category;
    existing.totalVisibleSeconds += deltaSeconds;
    existing.focusSeconds += focusDeltaSeconds;
    existing.lastSeenAt = seenAt;
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
    lastSeenAt: seenAt,
  });
}

function syncOpenWindowsStats(openWindows, nowIso, deltaSeconds, focusedClassificationKey) {
  for (const rawWindow of openWindows) {
    const candidate = toFocusedWindowProfile(rawWindow);
    const profile = ensureProfile(candidate);
    const focusDelta = profile.classificationKey === focusedClassificationKey ? deltaSeconds : 0;
    upsertWindowStat(profile, deltaSeconds, focusDelta, nowIso);
  }
}

function upsertActiveSession(profile, nowIso) {
  if (
    monitorCursor.activeSessionId &&
    monitorCursor.activeSessionStartAt &&
    monitorCursor.activeClassificationKey === profile.classificationKey
  ) {
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
  monitorCursor.activeSessionStartAt = nowIso;
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

  const last = monitorCursor.lastTickAt ? new Date(monitorCursor.lastTickAt).getTime() : now.getTime();
  const deltaSeconds = Math.max(1, Math.floor((now.getTime() - last) / 1000) || 1);
  monitorCursor.lastTickAt = nowIso;

  const activeWin = await getActiveWinApi();
  const [focusedRaw, openWindows] = await Promise.all([
    activeWin(),
    activeWin.getOpenWindows(),
  ]);

  const focusedProfileCandidate = toFocusedWindowProfile(focusedRaw);
  const focusedProfile = ensureProfile(focusedProfileCandidate);
  appState.currentFocusedWindow = focusedProfile;

  syncOpenWindowsStats(openWindows, nowIso, deltaSeconds, focusedProfile.classificationKey);
  upsertWindowStat(focusedProfile, deltaSeconds, deltaSeconds, nowIso);
  upsertActiveSession(focusedProfile, nowIso);

  scheduleSave();
  emitState();
}

function startMonitoring() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
  }

  monitorCursor.lastTickAt = new Date().toISOString();
  monitorTimer = setInterval(() => {
    monitorTick().catch(() => {
      // Ignore single-tick sampling failures and retry next cycle.
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
  if (Array.isArray(next.todos)) {
    appState.todos = next.todos;
  }
  if (Array.isArray(next.archives)) {
    appState.archives = next.archives;
  }
  if (next.pomodoroSettings && typeof next.pomodoroSettings === 'object') {
    appState.pomodoroSettings = {
      ...appState.pomodoroSettings,
      ...next.pomodoroSettings,
    };
  }
  if (next.displayMode === '显示窗口' || next.displayMode === '显示性质') {
    appState.displayMode = next.displayMode;
  }

  if (Array.isArray(next.profiles)) {
    const incomingMap = new Map();
    for (const profile of next.profiles) {
      if (profile && typeof profile.classificationKey === 'string' && typeof profile.category === 'string') {
        incomingMap.set(profile.classificationKey, profile.category);
      }
    }
    appState.profiles = appState.profiles.map(profile => {
      const incomingCategory = incomingMap.get(profile.classificationKey);
      if (!incomingCategory) {
        return profile;
      }
      return {
        ...profile,
        category: incomingCategory,
        updatedAt: new Date().toISOString(),
      };
    });
    appState.windowStats = appState.windowStats.map(item => {
      const incomingCategory = incomingMap.get(item.classificationKey);
      if (!incomingCategory) {
        return item;
      }
      return {
        ...item,
        category: incomingCategory,
      };
    });
  }
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => appState);
  ipcMain.handle('app:save-user-state', (_event, partial) => {
    mergeUserStateFromRenderer(partial);
    scheduleSave();
    emitState();
    return { ok: true };
  });
}

function registerPowerEvents() {
  powerMonitor.on('suspend', () => addPowerEvent('挂起', '系统挂起', '#a855f7'));
  powerMonitor.on('resume', () => addPowerEvent('恢复', '系统恢复', '#06b6d4'));
  powerMonitor.on('lock-screen', () => addPowerEvent('锁屏', '用户锁定', '#f59e0b'));
  powerMonitor.on('unlock-screen', () => addPowerEvent('解锁', '用户解锁', '#3b82f6'));
  powerMonitor.on('shutdown', () => addPowerEvent('关机', '系统关机', '#ef4444'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111827',
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
}

app.whenReady().then(() => {
  loadPersistedState();
  registerIpc();
  registerPowerEvents();
  createWindow();
  addPowerEvent('开机', '应用启动并开始监测', '#22c55e');
  startMonitoring();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopMonitoring();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeJsonSafe(getStatePath(), appState);
});
