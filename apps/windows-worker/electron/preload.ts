import { contextBridge, ipcRenderer } from "electron";
import { channels } from "../shared/channels";
import type { WorkerAPI } from "../shared/contracts";

const api: WorkerAPI = {
  bootstrap: () => ipcRenderer.invoke(channels.bootstrap),
  chooseProject: () => ipcRenderer.invoke(channels.chooseProject),
  openProject: (id) => ipcRenderer.invoke(channels.openProject, id),
  removeProject: (id) => ipcRenderer.invoke(channels.removeProject, id),
  projectStatus: (id) => ipcRenderer.invoke(channels.projectStatus, id),
  revealProject: (id) => ipcRenderer.invoke(channels.revealProject, id),
  saveDraft: (input) => ipcRenderer.invoke(channels.saveDraft, input),
  saveSettings: (input) => ipcRenderer.invoke(channels.saveSettings, input),
  chooseFile: (kind) => ipcRenderer.invoke(channels.chooseFile, kind),
  fetchModels: () => ipcRenderer.invoke(channels.fetchModels),
  checkTools: () => ipcRenderer.invoke(channels.checkTools),
};
contextBridge.exposeInMainWorld("worker", api);
