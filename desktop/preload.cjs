const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clipmaxDesktop', {
  openAntigravityUsage: () => ipcRenderer.invoke('antigravity-usage'),
  openAuth: url => ipcRenderer.invoke('open-auth', url),
  browserSignIn: platform => ipcRenderer.invoke('browser-sign-in', platform),
  browserPublish: input => ipcRenderer.invoke('browser-publish', input),
  onConnections: handler => ipcRenderer.on('show-connections', () => handler())
});
