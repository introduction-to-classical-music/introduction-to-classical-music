// Preload 运行在 `sandbox: true` 的渲染进程里，必须是 CommonJS（见 preload-launcher.cts）。
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

// Local-site window bridge: only the validated local-resource open action.
contextBridge.exposeInMainWorld("desktopLauncher", {
  openLocalResource: (target: string) => ipcRenderer.invoke("desktop:open-local-resource", target),
});
