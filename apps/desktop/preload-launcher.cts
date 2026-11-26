// Preload 运行在 `sandbox: true` 的渲染进程里：Electron 在沙箱下只以 CommonJS
// 执行 preload，ESM `import` 会抛 "Cannot use import statement outside a module"，
// bridge 不会注入（0.1.2 启动器按钮全部 undefined 即由此导致）。
// 因此本文件保持 CommonJS（`.cts` → 输出 `.cjs`），且只允许 require("electron")。
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

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
