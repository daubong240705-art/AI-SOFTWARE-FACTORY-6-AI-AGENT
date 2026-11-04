import { contextBridge, ipcRenderer } from "electron";
import { channels } from "../shared/channels";
import type { WorkerAPI } from "../shared/contracts";

const api: WorkerAPI = {
  enqueue: (input) => ipcRenderer.invoke(channels.enqueue, input),
  editFollowUp: (input) => ipcRenderer.invoke(channels.editFollowUp, input),
  removeFollowUp: (id) => ipcRenderer.invoke(channels.removeFollowUp, id),
  resumeFollowUp: (id) => ipcRenderer.invoke(channels.resumeFollowUp, id),
  retryRun: (id) => ipcRenderer.invoke(channels.retryRun, id),
  conversations: (input) => ipcRenderer.invoke(channels.conversations, input),
  conversation: (id, before) =>
    ipcRenderer.invoke(channels.conversation, { id, before }),
  createConversation: (id) =>
    ipcRenderer.invoke(channels.createConversation, id),
  renameConversation: (input) =>
    ipcRenderer.invoke(channels.renameConversation, input),
  saveConversationDraft: (input) =>
    ipcRenderer.invoke(channels.saveConversationDraft, input),
  openExternal: (url) => ipcRenderer.invoke(channels.openExternal, url),
  startRun: (input) => ipcRenderer.invoke(channels.startRun, input),
  stopRun: (id) => ipcRenderer.invoke(channels.stopRun, id),
  runtimeView: () => ipcRenderer.invoke(channels.runtimeView),
  runDetail: (id) => ipcRenderer.invoke(channels.runDetail, id),
  replyPermission: (input) =>
    ipcRenderer.invoke(channels.replyPermission, input),
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
