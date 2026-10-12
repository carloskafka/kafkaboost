const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizard', {
  info: () => ipcRenderer.invoke('app:info'),
  runStep: (step, opts) => ipcRenderer.invoke('step:run', step, opts),
  onLog: (cb) => ipcRenderer.on('step:log', (_e, step, line) => cb(step, line)),
  autostart: (mode) => ipcRenderer.invoke('app:autostart', mode),
  pickZip: () => ipcRenderer.invoke('dialog:zip'),
  relaunchAdmin: () => ipcRenderer.invoke('app:relaunchAdmin'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
});
