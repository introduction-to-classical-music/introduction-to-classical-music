import { contextBridge, ipcRenderer } from "electron";

// Launcher window bridge only. Other windows get narrower preloads.
contextBridge.exposeInMainWorld("desktopLauncher", {
  getLibraryStatus: () => ipcRenderer.invoke("launcher:get-library-status"),
  openLibrary: () => ipcRenderer.invoke("launcher:open-library"),
  openOwner: () => ipcRenderer.invoke("launcher:open-owner"),
  openRetrieval: () => ipcRenderer.invoke("launcher:open-retrieval"),
  importLibrary: () => ipcRenderer.invoke("launcher:import-library"),
  exportLibrary: (format?: "compressed" | "directory") => ipcRenderer.invoke("launcher:export-library", format),
  chooseExportFormat: () => ipcRenderer.invoke("launcher:choose-export-format"),
  openLibraryFolder: () => ipcRenderer.invoke("launcher:open-library-folder"),
  windowControl: (action: string) => ipcRenderer.invoke("launcher:window-control", action),
});
