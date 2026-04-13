const BRIDGE_ENDPOINT = 'http://127.0.0.1:17321/browser-bridge';
const HEARTBEAT_ALARM = 'mindful_bridge_heartbeat';
const HEARTBEAT_MINUTES = 0.5;

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

  const openDomainsSet = new Set();
  const openUrlsSet = new Set();
  for (const tab of allTabs) {
    const normalizedUrl = normalizeWebUrlFromUrl(tab.url);
    if (normalizedUrl) {
      openUrlsSet.add(normalizedUrl);
    }
    const domain = normalizeDomainFromUrl(normalizedUrl || tab.url);
    if (domain) {
      openDomainsSet.add(domain);
    }
  }

  const activeUrl = normalizeWebUrlFromUrl(activeTabs[0]?.url);
  const activeDomain = normalizeDomainFromUrl(activeUrl || activeTabs[0]?.url);
  if (activeUrl) {
    openUrlsSet.add(activeUrl);
  }
  if (activeDomain) {
    openDomainsSet.add(activeDomain);
  }

  return {
    browser: detectBrowser(),
    activeUrl: activeUrl || null,
    activeDomain: activeDomain || null,
    openUrls: [...openUrlsSet],
    openDomains: [...openDomainsSet],
    timestamp: new Date().toISOString(),
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
