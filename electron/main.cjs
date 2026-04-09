const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const POLL_INTERVAL_MS = 1000;
const MAX_SESSIONS = 60000;
const MAX_POWER_EVENTS = 5000;
const DESKTOP_KEY = 'desktop';
const DEFAULT_CATEGORY = '其他';
const DESKTOP_CATEGORY = '休息';
const DEFAULT_DISPLAY_MODE = '显示性质';

const BROWSER_BRIDGE_PORT = 17321;
const BROWSER_BRIDGE_ROUTE = '/browser-bridge';
const BROWSER_BRIDGE_HEALTH_ROUTE = '/health';
const BROWSER_BRIDGE_STALE_MS = 90 * 1000;
const BROWSER_DOMAIN_KEY_PREFIX = 'browser-domain';

const BROWSER_PROCESS_TO_ID = {
  'chrome.exe': 'chrome',
  'msedge.exe': 'edge',
  'brave.exe': 'brave',
  'firefox.exe': 'firefox',
  'opera.exe': 'opera',
  'vivaldi.exe': 'vivaldi',
};
const BROWSER_PROCESS_NAMES = new Set(Object.keys(BROWSER_PROCESS_TO_ID));

let mainWindow = null;
let monitorTimer = null;
let saveTimer = null;
let activeWinApi = null;
let browserBridgeServer = null;

/** @type {import('../src/types').AppState} */
let appState = createEmptyState();

let monitorCursor = {
  lastTickAt: null,
  activeSessionId: null,
  activeSessionStartAt: null,
  activeClassificationKey: null,
};

const browserBridgeState = {
  /** @type {Map<string, {activeDomain: string | null, openDomains: string[], updatedAtMs: number, updatedAtIso: string}>} */
  byBrowser: new Map(),
};

function createEmptyState() {
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
    displayMode: DEFAULT_DISPLAY_MODE,
  };
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'app-state.json');
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
    const hostname = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    if (!hostname) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

function normalizeBrowserId(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('edge')) {
    return 'edge';
  }
  if (normalized.includes('chrome')) {
    return 'chrome';
  }
  if (normalized.includes('firefox')) {
    return 'firefox';
  }
  if (normalized.includes('brave')) {
    return 'brave';
  }
  if (normalized.includes('opera')) {
    return 'opera';
  }
  if (normalized.includes('vivaldi')) {
    return 'vivaldi';
  }
  return normalized;
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
  const profiles = rawProfiles
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
    }));

  return {
    ...base,
    ...raw,
    profiles,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    windowStats: Array.isArray(raw.windowStats) ? raw.windowStats : [],
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    archives: Array.isArray(raw.archives) ? raw.archives : [],
    powerEvents: Array.isArray(raw.powerEvents) ? raw.powerEvents : [],
    currentFocusedWindow: raw.currentFocusedWindow ?? null,
    displayMode: typeof raw.displayMode === 'string' ? raw.displayMode : DEFAULT_DISPLAY_MODE,
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

function inferObjectType(processName, title, domain) {
  const lower = processName.toLowerCase();
  if (lower === 'explorer.exe' && isDesktopWindowTitle(title)) {
    return 'Desktop';
  }
  if (BROWSER_PROCESS_NAMES.has(lower) || domain) {
    return 'BrowserTab';
  }
  return 'AppWindow';
}

function buildClassificationKey({ objectType, processName, normalizedTitle, domain }) {
  if (objectType === 'Desktop') {
    return DESKTOP_KEY;
  }

  if (objectType === 'BrowserTab') {
    if (domain) {
      return `${BROWSER_DOMAIN_KEY_PREFIX}|${domain}`;
    }
    return `${BROWSER_DOMAIN_KEY_PREFIX}|${processName}|unknown`;
  }

  const titlePart = (normalizedTitle || '').trim().toLowerCase();
  return [objectType, processName.toLowerCase(), titlePart].filter(Boolean).join('|').slice(0, 300);
}

function toBrowserDomainProfile(domain, processName = 'browser') {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return null;
  }

  return {
    id: makeId('profile'),
    classificationKey: `${BROWSER_DOMAIN_KEY_PREFIX}|${normalizedDomain}`,
    displayName: normalizedDomain,
    objectType: 'BrowserTab',
    processName,
    browserName: undefined,
    normalizedTitle: normalizedDomain,
    domain: normalizedDomain,
    category: DEFAULT_CATEGORY,
    isBuiltIn: false,
    updatedAt: new Date().toISOString(),
  };
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

function getFreshBridgeOpenDomains() {
  const now = Date.now();
  const unionSet = new Set();

  for (const snapshot of browserBridgeState.byBrowser.values()) {
    if (now - snapshot.updatedAtMs > BROWSER_BRIDGE_STALE_MS) {
      continue;
    }
    for (const domain of snapshot.openDomains) {
      unionSet.add(domain);
    }
  }

  return [...unionSet];
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
  const browserSnapshot = getBridgeSnapshotForProcess(processName);
  const domainFromActiveWin = safeParseDomainFromUrl(rawWindow.url);
  const domain = domainFromActiveWin || browserSnapshot?.activeDomain || null;
  const objectType = inferObjectType(processName, title, domain);

  if (objectType === 'BrowserTab' && domain) {
    return {
      id: makeId('profile'),
      classificationKey: `${BROWSER_DOMAIN_KEY_PREFIX}|${domain}`,
      displayName: domain,
      objectType: 'BrowserTab',
      processName,
      browserName: rawWindow.owner?.name || undefined,
      normalizedTitle: domain,
      domain,
      category: DEFAULT_CATEGORY,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const normalizedTitle = title || processName;
  const classificationKey = buildClassificationKey({
    objectType,
    processName,
    normalizedTitle,
    domain,
  });

  return {
    id: makeId('profile'),
    classificationKey,
    displayName: objectType === 'BrowserTab' ? `${rawWindow.owner?.name || processName}（未知域名）` : normalizedTitle,
    objectType,
    processName,
    browserName: rawWindow.owner?.name || undefined,
    normalizedTitle,
    domain: domain || undefined,
    category: objectType === 'Desktop' ? DESKTOP_CATEGORY : DEFAULT_CATEGORY,
    isBuiltIn: objectType === 'Desktop',
    updatedAt: new Date().toISOString(),
  };
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

function upsertWindowStat(profile, deltaSeconds, focusDeltaSeconds, seenAtIso) {
  const existing = appState.windowStats.find(item => item.classificationKey === profile.classificationKey);
  if (existing) {
    existing.displayName = profile.displayName;
    existing.objectType = profile.objectType;
    existing.processName = profile.processName;
    existing.domain = profile.domain;
    existing.category = profile.category;
    existing.totalVisibleSeconds += deltaSeconds;
    existing.focusSeconds += focusDeltaSeconds;
    existing.lastSeenAt = seenAtIso;
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
    lastSeenAt: seenAtIso,
  });
}

function syncOpenWindowsStats(openWindows, focusedProfile, nowIso, deltaSeconds) {
  const bucket = new Map();

  for (const rawWindow of openWindows) {
    const candidate = toFocusedWindowProfile(rawWindow);
    bucket.set(candidate.classificationKey, candidate);
  }

  bucket.set(focusedProfile.classificationKey, focusedProfile);

  for (const domain of getFreshBridgeOpenDomains()) {
    const browserDomainProfile = toBrowserDomainProfile(domain);
    if (!browserDomainProfile) {
      continue;
    }
    if (!bucket.has(browserDomainProfile.classificationKey)) {
      bucket.set(browserDomainProfile.classificationKey, browserDomainProfile);
    }
  }

  for (const [classificationKey, candidate] of bucket.entries()) {
    const profile = ensureProfile(candidate);
    const focusDelta = classificationKey === focusedProfile.classificationKey ? deltaSeconds : 0;
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

function parseBrowserBridgePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }

  const browserId = normalizeBrowserId(rawPayload.browser);
  if (!browserId) {
    return null;
  }

  const openDomainsSet = new Set();
  if (Array.isArray(rawPayload.openDomains)) {
    for (const item of rawPayload.openDomains) {
      const domain = normalizeDomain(item);
      if (domain) {
        openDomainsSet.add(domain);
      }
    }
  }
  if (Array.isArray(rawPayload.openUrls)) {
    for (const item of rawPayload.openUrls) {
      const domain = safeParseDomainFromUrl(item);
      if (domain) {
        openDomainsSet.add(domain);
      }
    }
  }

  const activeDomain =
    normalizeDomain(rawPayload.activeDomain) ||
    safeParseDomainFromUrl(rawPayload.activeUrl) ||
    null;
  if (activeDomain) {
    openDomainsSet.add(activeDomain);
  }

  return {
    browserId,
    activeDomain,
    openDomains: [...openDomainsSet],
    updatedAtMs: Date.now(),
    updatedAtIso: new Date().toISOString(),
  };
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

    if (req.method !== 'POST' || req.url !== BROWSER_BRIDGE_ROUTE) {
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

      const normalized = parseBrowserBridgePayload(parsed);
      if (!normalized) {
        return sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      }

      browserBridgeState.byBrowser.set(normalized.browserId, {
        activeDomain: normalized.activeDomain,
        openDomains: normalized.openDomains,
        updatedAtMs: normalized.updatedAtMs,
        updatedAtIso: normalized.updatedAtIso,
      });

      scheduleSave();
      sendJson(res, 200, { ok: true });
    });
  });

  browserBridgeServer.listen(BROWSER_BRIDGE_PORT, '127.0.0.1', () => {
    // Browser extension can post tab-domain snapshots to this local endpoint.
  });

  browserBridgeServer.on('error', () => {
    // Keep app running even if bridge port is occupied.
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

  const lastTickMs = monitorCursor.lastTickAt ? new Date(monitorCursor.lastTickAt).getTime() : now.getTime();
  const deltaSeconds = Math.max(1, Math.floor((now.getTime() - lastTickMs) / 1000) || 1);
  monitorCursor.lastTickAt = nowIso;

  const activeWin = await getActiveWinApi();
  const [focusedRaw, openWindows] = await Promise.all([activeWin(), activeWin.getOpenWindows()]);

  const focusedProfile = ensureProfile(toFocusedWindowProfile(focusedRaw));
  appState.currentFocusedWindow = focusedProfile;

  syncOpenWindowsStats(openWindows, focusedProfile, nowIso, deltaSeconds);
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
      // Ignore single-tick sampling failure.
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
  if (typeof next.displayMode === 'string') {
    appState.displayMode = next.displayMode;
  }

  if (Array.isArray(next.profiles)) {
    const incomingCategoryMap = new Map();
    for (const profile of next.profiles) {
      if (profile && typeof profile.classificationKey === 'string' && typeof profile.category === 'string') {
        incomingCategoryMap.set(profile.classificationKey, profile.category);
      }
    }

    appState.profiles = appState.profiles.map(profile => {
      const incomingCategory = incomingCategoryMap.get(profile.classificationKey);
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
      const incomingCategory = incomingCategoryMap.get(item.classificationKey);
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
  startBrowserBridgeServer();
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
  stopBrowserBridgeServer();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeJsonSafe(getStatePath(), appState);
});
