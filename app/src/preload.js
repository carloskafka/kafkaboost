const { contextBridge, ipcRenderer } = require('electron');

// The only surface the renderer can use. Everything is a plain IPC call; no Node access in the page.
contextBridge.exposeInMainWorld('kb', {
  info: () => ipcRenderer.invoke('app:info'),
  runStep: (step, opts) => ipcRenderer.invoke('step:run', step, opts),
  onLog: (cb) => ipcRenderer.on('step:log', (_e, step, line) => cb(step, line)),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
    onChange: (cb) => ipcRenderer.on('settings:changed', (_e, payload) => cb(payload))
  },
  i18n: () => ipcRenderer.invoke('i18n:get'),
  autostart: (mode) => ipcRenderer.invoke('app:autostart', mode),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  whatsNew: () => ipcRenderer.invoke('app:whatsNew'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdate: (event, cb) => ipcRenderer.on('update:' + event, (_e, payload) => cb(payload)),
  openPath: (which) => ipcRenderer.invoke('app:openPath', which),
  openInstallDir: () => ipcRenderer.invoke('app:openInstallDir'),
  clearCache: () => ipcRenderer.invoke('app:clearCache'),
  pickZip: () => ipcRenderer.invoke('dialog:zip'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  relaunchAdmin: () => ipcRenderer.invoke('app:relaunchAdmin'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
});
