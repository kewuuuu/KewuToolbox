const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

const PROTOCOL_VERSION = '1.0';
const BRIDGE_ENDPOINT = 'http://127.0.0.1:17321/plugin-bridge';
const HEARTBEAT_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 1500;
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
    notes: 'Compatible with workspace-level VS Code process replacement.',
  },
];

function normalizeFsPath(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().replace(/\\/g, '/').toLowerCase();
}

function toNonEmptyString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getWorkspaceName() {
  const fromWorkspace = toNonEmptyString(vscode.workspace.name);
  if (fromWorkspace) {
    return fromWorkspace;
  }

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme === 'file') {
    const basename = path.basename(workspaceFile.fsPath, path.extname(workspaceFile.fsPath));
    if (basename) {
      return basename;
    }
  }

  const folders = Array.isArray(vscode.workspace.workspaceFolders)
    ? vscode.workspace.workspaceFolders
    : [];
  if (folders.length === 1) {
    return toNonEmptyString(folders[0].name, '未命名工作区');
  }
  if (folders.length > 1) {
    return `${folders.length}个文件夹工作区`;
  }
  return '未打开工作区';
}

function getWorkspaceIdentity() {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme === 'file') {
    const normalizedPath = normalizeFsPath(workspaceFile.fsPath);
    if (normalizedPath) {
      return `workspace-file:${normalizedPath}`;
    }
  }

  const folders = Array.isArray(vscode.workspace.workspaceFolders)
    ? vscode.workspace.workspaceFolders
    : [];
  const folderKeys = folders
    .filter(folder => folder && folder.uri && folder.uri.scheme === 'file')
    .map(folder => normalizeFsPath(folder.uri.fsPath))
    .filter(Boolean)
    .sort();
  if (folderKeys.length > 0) {
    return `workspace-folders:${folderKeys.join('|')}`;
  }

  return 'workspace-empty';
}

function getVsCodeProcessName() {
  const fromExecPath = path.basename(process.execPath || '').trim().toLowerCase();
  if (fromExecPath) {
    return fromExecPath;
  }
  return 'code.exe';
}

function getPluginMeta(context, instanceSuffix) {
  const version = toNonEmptyString(context?.extension?.packageJSON?.version, '0.0.0');
  return {
    id: `official-vscode-workspace-bridge-${instanceSuffix}`,
    name: 'Kewu VSCode 工作区桥接插件',
    version,
    homepageUrl: 'https://github.com/kewuuuu/KewuToolbox',
    isOfficial: true,
    compatibility: PLUGIN_COMPATIBILITY,
  };
}

function postJson(urlString, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload ?? {});
    const target = new URL(urlString);
    const request = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`http_${statusCode}`));
            return;
          }
          if (!raw.trim()) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', error => {
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

async function requestRuleMatch(pluginMeta, candidate) {
  try {
    const data = await postJson(BRIDGE_ENDPOINT, {
      protocolVersion: PROTOCOL_VERSION,
      source: 'vscode-plugin',
      requestType: 'match-rules',
      plugin: pluginMeta,
      candidates: [candidate],
    });
    if (!data || data.ok !== true || !Array.isArray(data.matches)) {
      return { whitelist: [], blacklist: [] };
    }
    const matched = data.matches.find(
      item => item && item.candidateKey === candidate.candidateKey,
    );
    if (!matched) {
      return { whitelist: [], blacklist: [] };
    }
    return {
      whitelist: Array.isArray(matched.whitelist) ? matched.whitelist : [],
      blacklist: Array.isArray(matched.blacklist) ? matched.blacklist : [],
    };
  } catch {
    return { whitelist: [], blacklist: [] };
  }
}

async function buildSnapshot(pluginMeta) {
  const workspaceName = getWorkspaceName();
  const workspaceIdentity = getWorkspaceIdentity();
  const processName = getVsCodeProcessName();
  const workspaceDisplayName = `${workspaceName} - Visual Studio Code`;
  const workspaceKey = `plugin-vscode-workspace|${workspaceIdentity}`;
  const focused = Boolean(vscode.window.state.focused);

  const candidate = {
    candidateKey: workspaceKey,
    displayName: workspaceDisplayName,
    normalizedTitle: workspaceDisplayName,
    objectType: 'AppWindow',
    processName,
  };

  const matchedRules = await requestRuleMatch(pluginMeta, candidate);
  const hasBlacklist = Array.isArray(matchedRules.blacklist) && matchedRules.blacklist.length > 0;
  const whitelistRules = Array.isArray(matchedRules.whitelist) ? matchedRules.whitelist : [];

  let records = [];
  let focusedClassificationKeys = [];

  if (!hasBlacklist && whitelistRules.length > 0) {
    records = whitelistRules
      .filter(rule => rule && typeof rule.id === 'string' && rule.id)
      .map(rule => {
        const fallbackName =
          toNonEmptyString(rule.namePattern) ||
          toNonEmptyString(rule.typePattern) ||
          toNonEmptyString(rule.processPattern) ||
          rule.id;
        return {
          classificationKey: `process-whitelist|${rule.id}`,
          displayName: toNonEmptyString(rule.name, fallbackName),
          normalizedTitle: workspaceDisplayName,
          objectType: 'AppWindow',
          processName,
        };
      });

    if (focused && records.length > 0) {
      focusedClassificationKeys = records.map(record => record.classificationKey);
    }
  } else if (!hasBlacklist) {
    records = [
      {
        classificationKey: workspaceKey,
        displayName: workspaceDisplayName,
        normalizedTitle: workspaceDisplayName,
        objectType: 'AppWindow',
        processName,
      },
    ];

    if (focused) {
      focusedClassificationKeys = [workspaceKey];
    }
  }

  const uniqueFocusedClassificationKeys = [...new Set(focusedClassificationKeys)];

  return {
    protocolVersion: PROTOCOL_VERSION,
    source: 'vscode-plugin',
    plugin: pluginMeta,
    snapshot: {
      timestamp: new Date().toISOString(),
      focusedClassificationKey: uniqueFocusedClassificationKeys[0] || null,
      focusedClassificationKeys: uniqueFocusedClassificationKeys,
      suppressRules: [
        {
          typePattern: 'AppWindow',
          processPattern: processName,
        },
      ],
      records,
    },
  };
}

function createScheduler(context) {
  const instanceSuffix = `${process.pid}-${Date.now().toString(36)}`;
  const pluginMeta = getPluginMeta(context, instanceSuffix);
  let running = false;
  let pending = false;

  const run = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      const payload = await buildSnapshot(pluginMeta);
      await postJson(BRIDGE_ENDPOINT, payload);
    } catch {
      // Bridge unavailable or transient errors are ignored.
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  };

  return { run };
}

function activate(context) {
  const scheduler = createScheduler(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('kewuToolboxVscodeBridge.forceSync', () => scheduler.run()),
  );
  context.subscriptions.push(vscode.window.onDidChangeWindowState(() => scheduler.run()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => scheduler.run()));
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => scheduler.run()),
  );

  const timer = setInterval(() => {
    void scheduler.run();
  }, HEARTBEAT_INTERVAL_MS);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      clearInterval(timer);
    }),
  );

  void scheduler.run();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
