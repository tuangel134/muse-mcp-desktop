// Puente mínimo entre el panel (página local) y el proceso principal. El panel no tiene acceso a Node ni al token.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.error) throw new Error(r.error);
  return r ? r.data : undefined;
};

contextBridge.exposeInMainWorld('museMcp', {
  request: (path, payload) => call('mcp:request', path, payload),
  pickFolder: () => call('app:pick-folder'),
  copy: (text) => call('app:copy', String(text)),
  setupPrompt: (url) => call('app:setup-prompt', String(url)),
  insertInMuse: (text) => call('muse:insert', String(text)),
  togglePanel: () => call('panel:toggle'),
  onPanelState: (fn) => ipcRenderer.on('panel:state', (_e, open) => fn(Boolean(open))),
  info: () => call('app:info')
});
