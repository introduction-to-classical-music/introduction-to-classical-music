import { contextBridge, ipcRenderer } from "electron";

// Owner window bridge (maintenance UI). Deliberately excludes launcher-only
// window controls and import/export orchestration APIs.
contextBridge.exposeInMainWorld("desktopLauncher", {
  openLibrary: () => ipcRenderer.invoke("launcher:open-library"),
  activateLibrary: (rootDir: string) => ipcRenderer.invoke("desktop:activate-library", rootDir),
  renameLibrary: (libraryName: string) => ipcRenderer.invoke("desktop:rename-library", libraryName),
  openLocalResource: (target: string) => ipcRenderer.invoke("desktop:open-local-resource", target),
  pickLibraryFolder: () => ipcRenderer.invoke("desktop:pick-library-folder"),
  pickDirectory: () => ipcRenderer.invoke("desktop:pick-directory"),
  pickLocalResourceFile: () => ipcRenderer.invoke("desktop:pick-local-resource-file"),
});
