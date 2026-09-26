const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whaleAPI', {
  getSnapshot: () => ipcRenderer.invoke('whale:get-snapshot'),
  getCodexUsage: (force = false) => ipcRenderer.invoke('whale:get-codex-usage', force),
  getCodexThreads: (force = false) => ipcRenderer.invoke('whale:get-codex-threads', force),
  openCodexThread: (threadId) => ipcRenderer.invoke('whale:open-codex-thread', threadId),
  getConfig: () => ipcRenderer.invoke('whale:get-config'),
  saveConfig: (patch) => ipcRenderer.invoke('whale:save-config', patch),
  refreshBalance: () => ipcRenderer.invoke('whale:refresh-balance'),
  ask: (question) => ipcRenderer.invoke('whale:ask', question),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('whale:set-always-on-top', value),
  setClickThrough: (value) => ipcRenderer.invoke('whale:set-click-through', value),
  openDataDirectory: () => ipcRenderer.invoke('whale:open-data-directory'),
  beginDrag: () => ipcRenderer.invoke('whale:begin-drag'),
  endDrag: () => ipcRenderer.invoke('whale:end-drag'),
  setPanelOpen: (value) => ipcRenderer.invoke('whale:set-panel-open', value),
  setBubbleExpanded: (value) => ipcRenderer.invoke('whale:set-bubble-expanded', value),
  minimize: () => ipcRenderer.invoke('whale:minimize'),
  quit: () => ipcRenderer.invoke('whale:quit'),
  onDisplayScale: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('whale:display-scale', listener)
    return () => ipcRenderer.removeListener('whale:display-scale', listener)
  },
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('whale:snapshot', listener)
    return () => ipcRenderer.removeListener('whale:snapshot', listener)
  },
  onPetState: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('whale:pet-state', listener)
    return () => ipcRenderer.removeListener('whale:pet-state', listener)
  },
  onCodexActivity: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('whale:codex-activity', listener)
    return () => ipcRenderer.removeListener('whale:codex-activity', listener)
  },
})
