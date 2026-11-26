// Preload 运行在 `sandbox: true` 的渲染进程里，必须是 CommonJS（见 preload-launcher.cts）。
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

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
