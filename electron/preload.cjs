const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  isElectron: true,
  getState: () => ipcRenderer.invoke('app:get-state'),
  getActivityData: (payload) => ipcRenderer.invoke('app:get-activity-data', payload),
  getActivityDateKeys: () => ipcRenderer.invoke('app:get-activity-date-keys'),
  getAnalyticsSummary: (payload) => ipcRenderer.invoke('app:get-analytics-summary', payload),
  getMonitoringSummary: (payload) => ipcRenderer.invoke('app:get-monitoring-summary', payload),
  deleteMonitoringRecords: (payload) => ipcRenderer.invoke('app:delete-monitoring-records', payload),
  getAppVersion: () => ipcRenderer.invoke('app:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  startPortableUpdate: (payload) => ipcRenderer.invoke('app:start-portable-update', payload),
  openExternalUrl: (payload) => ipcRenderer.invoke('app:open-external-url', payload),
  getDataFilePath: () => ipcRenderer.invoke('app:get-data-file-path'),
  getStorageStatus: () => ipcRenderer.invoke('app:get-storage-status'),
  migrateLegacyJsonStorage: () => ipcRenderer.invoke('app:migrate-legacy-json-storage'),
  rebuildAnalyticsCache: () => ipcRenderer.invoke('app:rebuild-analytics-cache'),
  setDataFilePath: (payload) => ipcRenderer.invoke('app:set-data-file-path', payload),
  selectDataFilePath: () => ipcRenderer.invoke('app:select-data-file-path'),
  saveUserState: (partial) => ipcRenderer.invoke('app:save-user-state', partial),
  mergeRecordsByWhitelist: () => ipcRenderer.invoke('app:merge-records-by-whitelist'),
  clearAllData: () => ipcRenderer.invoke('app:clear-all-data'),
  clearDiagnosticLogs: () => ipcRenderer.invoke('app:clear-diagnostic-logs'),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  hideToTray: () => ipcRenderer.invoke('app:hide-to-tray'),
  selectAudioFile: () => ipcRenderer.invoke('app:select-audio-file'),
  getClipboardCurrent: () => ipcRenderer.invoke('clipboard:get-current'),
  getClipboardHistory: () => ipcRenderer.invoke('clipboard:get-history'),
  restoreClipboardHistoryItem: (payload) => ipcRenderer.invoke('clipboard:restore-history-item', payload),
  writeClipboardItem: (payload) => ipcRenderer.invoke('clipboard:write-item', payload),
  onClipboardChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => {
      callback(payload);
    };

    ipcRenderer.on('clipboard:changed', listener);
    return () => {
      ipcRenderer.removeListener('clipboard:changed', listener);
    };
  },
  onUpdateProgress: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, progress) => {
      callback(progress);
    };

    ipcRenderer.on('app:update-progress', listener);
    return () => {
      ipcRenderer.removeListener('app:update-progress', listener);
    };
  },
  onState: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, nextState) => {
      callback(nextState);
    };

    ipcRenderer.on('monitor:state', listener);
    return () => {
      ipcRenderer.removeListener('monitor:state', listener);
    };
  },
});
