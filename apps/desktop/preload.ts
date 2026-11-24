import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopLauncher", {
  getLibraryStatus: () => ipcRenderer.invoke("launcher:get-library-status"),
  openLibrary: () => ipcRenderer.invoke("launcher:open-library"),
  openOwner: () => ipcRenderer.invoke("launcher:open-owner"),
  openRetrieval: () => ipcRenderer.invoke("launcher:open-retrieval"),
  importLibrary: () => ipcRenderer.invoke("launcher:import-library"),
  exportLibrary: (format?: "compressed" | "directory") => ipcRenderer.invoke("launcher:export-library", format),
  chooseExportFormat: () => ipcRenderer.invoke("launcher:choose-export-format"),
  renameLibrary: (libraryName: string) => ipcRenderer.invoke("desktop:rename-library", libraryName),
  activateLibrary: (rootDir: string) => ipcRenderer.invoke("desktop:activate-library", rootDir),
  openLibraryFolder: () => ipcRenderer.invoke("launcher:open-library-folder"),
  openExternal: (target: string) => ipcRenderer.invoke("desktop:open-external", target),
  // W3/D3-A: local resource links in the local site are opened over IPC after
  // the main process validates that the path belongs to the active library.
  openLocalResource: (target: string) => ipcRenderer.invoke("desktop:open-local-resource", target),
  pickLibraryFolder: () => ipcRenderer.invoke("desktop:pick-library-folder"),
  pickDirectory: () => ipcRenderer.invoke("desktop:pick-directory"),
  pickLocalResourceFile: () => ipcRenderer.invoke("desktop:pick-local-resource-file"),
  windowControl: (action: string) => ipcRenderer.invoke("launcher:window-control", action),
});
