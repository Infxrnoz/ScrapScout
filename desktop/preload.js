const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
    linkSteam: () => ipcRenderer.invoke('link-steam'),
    onLinkProgress: fn => ipcRenderer.on('link-progress', (e, p) => fn(p)),
    show: () => ipcRenderer.send('show-window'),
    getOverlay: () => ipcRenderer.invoke('overlay-get'),
    setOverlay: settings => ipcRenderer.invoke('overlay-set', settings),
    onOverlay: fn => ipcRenderer.on('overlay-settings', (e, s) => fn(s)),
    displays: () => ipcRenderer.invoke('overlay-displays'),
    onAppOverlay: fn => ipcRenderer.on('app-overlay', (e, on) => fn(on)),
    hotkeys: () => ipcRenderer.invoke('hotkeys'),
    getColor: () => ipcRenderer.invoke('color-get'),
    setColor: patch => ipcRenderer.invoke('color-set', patch),
    onColor: fn => ipcRenderer.on('color-settings', (e, c) => fn(c))
});
