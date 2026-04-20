const BRIDGE_ENDPOINT = 'http://127.0.0.1:17321/plugin-bridge';
const HEARTBEAT_ALARM = 'mindful_bridge_heartbeat';
const HEARTBEAT_MINUTES = 0.5;
const PLUGIN_ID = 'official-browser-bridge';
const PLUGIN_NAME = 'Kewu 浏览器桥接插件';
const PROTOCOL_VERSION = '1.0';

let pushQueued = false;

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (ua.includes('Edg/')) {
    return 'edge';
  }
  if (ua.includes('Brave/')) {
    return 'brave';
  }
  if (ua.includes('OPR/')) {
    return 'opera';
  }
  if (ua.includes('Vivaldi/')) {
    return 'vivaldi';
  }
  return 'chrome';
}

function normalizeDomainFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function normalizeWebUrlFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.replace(/^www\./, '').replace(/\.$/, '').toLowerCase();
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

async function collectSnapshot() {
  const [allTabs, activeTabs] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);

  const recordMap = new Map();
  const processName = `${detectBrowser()}.exe`;
  let focusedClassificationKey = null;
  for (const tab of allTabs) {
    const normalizedUrl = normalizeWebUrlFromUrl(tab.url);
    if (!normalizedUrl) {
      continue;
    }
    const domain = normalizeDomainFromUrl(normalizedUrl || tab.url) || undefined;
    const classificationKey = `plugin-browser-tab|${normalizedUrl}`;
    if (!recordMap.has(classificationKey)) {
      const displayName =
        typeof tab.title === 'string' && tab.title.trim().length > 0
          ? tab.title.trim()
          : domain || normalizedUrl;
      recordMap.set(classificationKey, {
        classificationKey,
        displayName,
        normalizedTitle: normalizedUrl,
        objectType: 'BrowserTab',
        processName,
        domain,
      });
    }
  }

  const activeUrl = normalizeWebUrlFromUrl(activeTabs[0]?.url);
  if (activeUrl) {
    focusedClassificationKey = `plugin-browser-tab|${activeUrl}`;
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    source: 'browser-extension',
    plugin: {
      id: PLUGIN_ID,
      name: PLUGIN_NAME,
      version: chrome.runtime.getManifest().version,
      homepageUrl: chrome.runtime.getManifest().homepage_url || undefined,
      isOfficial: true,
    },
    snapshot: {
      records: [...recordMap.values()],
      focusedClassificationKey,
      suppressRules: [
        { typePattern: 'AppWindow', processPattern: 'chrome.exe' },
        { typePattern: 'AppWindow', processPattern: 'msedge.exe' },
        { typePattern: 'AppWindow', processPattern: 'brave.exe' },
        { typePattern: 'AppWindow', processPattern: 'firefox.exe' },
        { typePattern: 'AppWindow', processPattern: 'opera.exe' },
        { typePattern: 'AppWindow', processPattern: 'vivaldi.exe' },
      ],
      timestamp: new Date().toISOString(),
    },
  };
}

async function pushSnapshot() {
  const payload = await collectSnapshot();
  await fetch(BRIDGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function queuePush() {
  if (pushQueued) {
    return;
  }
  pushQueued = true;
  setTimeout(() => {
    pushQueued = false;
    void pushSnapshot().catch(() => {
      // Desktop app might not be running yet.
    });
  }, 200);
}

function ensureHeartbeatAlarm() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureHeartbeatAlarm();
  queuePush();
});

chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeatAlarm();
  queuePush();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === HEARTBEAT_ALARM) {
    queuePush();
  }
});

chrome.tabs.onActivated.addListener(() => queuePush());
chrome.tabs.onRemoved.addListener(() => queuePush());
chrome.tabs.onCreated.addListener(() => queuePush());
chrome.tabs.onAttached.addListener(() => queuePush());
chrome.tabs.onDetached.addListener(() => queuePush());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    queuePush();
  }
});
chrome.windows.onFocusChanged.addListener(() => queuePush());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'sync-now') {
    return false;
  }

  queuePush();
  sendResponse({ ok: true });
  return true;
});
