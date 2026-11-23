const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clipmaxDesktop', {
  openAuth: url => ipcRenderer.invoke('open-auth', url),
  browserSignIn: platform => ipcRenderer.invoke('browser-sign-in', platform),
  browserPublish: input => ipcRenderer.invoke('browser-publish', input),
  onConnections: handler => ipcRenderer.on('show-connections', () => handler())
});
