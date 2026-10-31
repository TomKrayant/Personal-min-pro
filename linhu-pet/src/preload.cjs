'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getStats: () => ipcRenderer.invoke('pet:get-stats'),
  getState: () => ipcRenderer.invoke('pet:get-state'),
  onStats: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('pet:stats', listener);
    return () => ipcRenderer.removeListener('pet:stats', listener);
  },
  onPanel: (callback) => {
    const listener = (_event, open) => callback(Boolean(open));
    ipcRenderer.on('pet:panel', listener);
    return () => ipcRenderer.removeListener('pet:panel', listener);
  },
  dragStart: () => ipcRenderer.invoke('pet:drag-start'),
  dragEnd: (moved) => ipcRenderer.invoke('pet:drag-end', { moved: Boolean(moved) }),
  setPanelOpen: (open) => ipcRenderer.invoke('pet:set-panel', Boolean(open)),
  openDsh: () => ipcRenderer.invoke('pet:open-dsh'),
  showContextMenu: () => ipcRenderer.invoke('pet:context-menu'),
  refresh: () => ipcRenderer.invoke('pet:refresh'),
});
