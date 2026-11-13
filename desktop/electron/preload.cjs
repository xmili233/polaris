const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('polaris', {
  onAgent: callback => {
    const listener = () => callback();
    ipcRenderer.on('polaris:agent-changed', listener);
    return () => ipcRenderer.removeListener('polaris:agent-changed', listener);
  },
  onSettings: callback => {
    const listener = () => callback();
    ipcRenderer.on('polaris:open-settings', listener);
    return () => ipcRenderer.removeListener('polaris:open-settings', listener);
  },
  setLanguage: language => ipcRenderer.invoke('polaris:set-language', language),
  setAppearance: appearance => ipcRenderer.invoke('polaris:set-appearance', appearance),
  onConfig: callback => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('polaris:config-changed', listener);
    return () => ipcRenderer.removeListener('polaris:config-changed', listener);
  },
  config: () => ipcRenderer.invoke('polaris:config'),
  call: (method, params = {}) => ipcRenderer.invoke('polaris:call', method, params),
  copyText: text => ipcRenderer.invoke('polaris:copy-text', text),
  pickAttachments: () => ipcRenderer.invoke('polaris:pick-attachments'),
  openLink: (url) => ipcRenderer.invoke('polaris:link', url),
  captureLayout: (frames) => ipcRenderer.invoke('polaris:layout', frames),
});
