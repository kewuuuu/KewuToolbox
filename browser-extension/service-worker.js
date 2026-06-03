const BRIDGE_ENDPOINT = 'http://127.0.0.1:17321/plugin-bridge';
const HEARTBEAT_ALARM = 'mindful_bridge_heartbeat';
const HEARTBEAT_MINUTES = 0.5;
const PLUGIN_ID = 'official-browser-bridge';
const PLUGIN_NAME = 'Kewu 浏览器桥接插件';
const PROTOCOL_VERSION = '1.0';
const PLUGIN_COMPATIBILITY = [
  {
    pluginVersion: '1.0.4',
    compatibleKewuToolboxVersions: '>=1.0.2 <2.0.0',
    protocolVersion: PROTOCOL_VERSION,
    notes: 'Same bridge behavior as 1.0.3. Repacked with KewuToolbox v1.0.4 release assets only.',
  },
  {
    pluginVersion: '1.0.3',
    compatibleKewuToolboxVersions: '>=1.0.2 <2.0.0',
    protocolVersion: PROTOCOL_VERSION,
    notes: 'Compatible with the unified plugin bridge and rule matching protocol.',
  },
  {
    pluginVersion: '1.0.2',
    compatibleKewuToolboxVersions: '>=1.0.2 <2.0.0',
    protocolVersion: PROTOCOL_VERSION,
    notes: 'Compatible with whitelist/blacklist matching and focusedClassificationKeys.',
  },
];

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

function browserIdToProcessName(browserId) {
  switch (browserId) {
    case 'edge':
      return 'msedge.exe';
    case 'brave':
      return 'brave.exe';
    case 'firefox':
      return 'firefox.exe';
    case 'opera':
      return 'opera.exe';
    case 'vivaldi':
      return 'vivaldi.exe';
    case 'chrome':
    default:
      return 'chrome.exe';
  }
}

function getPluginMeta() {
  const manifest = chrome.runtime.getManifest();
  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: manifest.version,
    homepageUrl: manifest.homepage_url || undefined,
    isOfficial: true,
    compatibility: PLUGIN_COMPATIBILITY,
  };
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
  const browserId = detectBrowser();
  const processName = browserIdToProcessName(browserId);
  const [allTabs, activeTabs] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);

  const tabItems = [];
  for (const tab of allTabs) {
    const normalizedUrl = normalizeWebUrlFromUrl(tab.url);
    if (!normalizedUrl) {
      continue;
    }
    const domain = normalizeDomainFromUrl(normalizedUrl || tab.url) || '';
    const displayName =
      typeof tab.title === 'string' && tab.title.trim().length > 0
        ? tab.title.trim()
        : domain || normalizedUrl;
    tabItems.push({
      normalizedUrl,
      domain,
      displayName,
    });
  }

  const activeUrl = normalizeWebUrlFromUrl(activeTabs[0]?.url);
  const ruleMatchMap = await requestRuleMatches(
    tabItems.map(item => ({
      candidateKey: item.normalizedUrl,
      displayName: item.displayName,
      normalizedTitle: item.normalizedUrl,
      objectType: 'BrowserTab',
      processName,
      domain: item.domain || undefined,
    })),
  );

  const recordMap = new Map();
  const focusedClassificationKeys = [];
  for (const tabItem of tabItems) {
    const match = ruleMatchMap.get(tabItem.normalizedUrl) || {
      whitelist: [],
      blacklist: [],
    };

    if (Array.isArray(match.blacklist) && match.blacklist.length > 0) {
      continue;
    }

    if (Array.isArray(match.whitelist) && match.whitelist.length > 0) {
      for (const whitelistRule of match.whitelist) {
        const ruleId = typeof whitelistRule.id === 'string' ? whitelistRule.id : '';
        if (!ruleId) {
          continue;
        }
        const key = `process-whitelist|${ruleId}`;
        if (!recordMap.has(key)) {
          const ruleName =
            typeof whitelistRule.name === 'string' && whitelistRule.name.trim().length > 0
              ? whitelistRule.name.trim()
              : `白名单规则 ${ruleId}`;
          recordMap.set(key, {
            classificationKey: key,
            displayName: ruleName,
            normalizedTitle: tabItem.normalizedUrl,
            objectType: 'BrowserTab',
            processName,
            domain: tabItem.domain || undefined,
          });
        }
        if (activeUrl === tabItem.normalizedUrl) {
          focusedClassificationKeys.push(key);
        }
      }
      continue;
    }

    const domainKey = tabItem.domain
      ? `plugin-browser-domain|${tabItem.domain}`
      : `plugin-browser-url|${tabItem.normalizedUrl}`;
    if (!recordMap.has(domainKey)) {
      recordMap.set(domainKey, {
        classificationKey: domainKey,
        displayName: tabItem.domain || tabItem.normalizedUrl,
        normalizedTitle: tabItem.domain || tabItem.normalizedUrl,
        objectType: 'BrowserTab',
        processName,
        domain: tabItem.domain || undefined,
      });
    }
    if (activeUrl === tabItem.normalizedUrl) {
      focusedClassificationKeys.push(domainKey);
    }
  }

  const uniqueFocusedClassificationKeys = [...new Set(focusedClassificationKeys)];

  return {
    protocolVersion: PROTOCOL_VERSION,
    source: 'browser-extension',
    plugin: getPluginMeta(),
    snapshot: {
      records: [...recordMap.values()],
      focusedClassificationKey: uniqueFocusedClassificationKeys[0] || null,
      focusedClassificationKeys: uniqueFocusedClassificationKeys,
      suppressRules: [
        { typePattern: 'AppWindow', processPattern: processName },
      ],
      timestamp: new Date().toISOString(),
    },
  };
}

async function requestRuleMatches(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return new Map();
  }
  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        source: 'browser-extension',
        requestType: 'match-rules',
        plugin: getPluginMeta(),
        candidates,
      }),
    });
    if (!response.ok) {
      return new Map();
    }
    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.matches)) {
      return new Map();
    }
    const map = new Map();
    for (const item of data.matches) {
      if (!item || typeof item.candidateKey !== 'string') {
        continue;
      }
      map.set(item.candidateKey, {
        whitelist: Array.isArray(item.whitelist) ? item.whitelist : [],
        blacklist: Array.isArray(item.blacklist) ? item.blacklist : [],
      });
    }
    return map;
  } catch {
    return new Map();
  }
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
