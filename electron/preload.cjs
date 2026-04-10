const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  isElectron: true,
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveUserState: (partial) => ipcRenderer.invoke('app:save-user-state', partial),
  clearAllData: () => ipcRenderer.invoke('app:clear-all-data'),
  selectAudioFile: () => ipcRenderer.invoke('app:select-audio-file'),
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
