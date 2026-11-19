import { contextBridge, ipcRenderer } from "electron";

// Local-site window bridge: only the validated local-resource open action.
contextBridge.exposeInMainWorld("desktopLauncher", {
  openLocalResource: (target: string) => ipcRenderer.invoke("desktop:open-local-resource", target),
});
