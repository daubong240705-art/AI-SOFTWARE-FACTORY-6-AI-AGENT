import { contextBridge, ipcRenderer } from "electron";
import { channels } from "../shared/channels";
import type { WorkerAPI } from "../shared/contracts";

const api: WorkerAPI = {
  importChatImage: (input) =>
    ipcRenderer.invoke(channels.importChatImage, input),
  removeChatImage: (input) =>
    ipcRenderer.invoke(channels.removeChatImage, input),
  gitSnapshot: (input) => ipcRenderer.invoke(channels.gitSnapshot, input),
  gitDiff: (input) => ipcRenderer.invoke(channels.gitDiff, input),
  inbox: (input) => ipcRenderer.invoke(channels.inbox, input),
  inboxSeen: (input) => ipcRenderer.invoke(channels.inboxSeen, input),
  readiness: (input) => ipcRenderer.invoke(channels.readiness, input),
  workReport: (input) => ipcRenderer.invoke(channels.workReport, input),
  reportFile: (input) => ipcRenderer.invoke(channels.reportFile, input),
  reportDecision: (input) => ipcRenderer.invoke(channels.reportDecision, input),
  reportPolicy: (input) => ipcRenderer.invoke(channels.reportPolicy, input),
  questionSet: (input) => ipcRenderer.invoke(channels.questionSet, input),
  saveQuestionDraft: (input) =>
    ipcRenderer.invoke(channels.saveQuestionDraft, input),
  answerQuestions: (input) =>
    ipcRenderer.invoke(channels.answerQuestions, input),
  workChatForRun: (input) => ipcRenderer.invoke(channels.workChatForRun, input),
  sendChat: (input) => ipcRenderer.invoke(channels.sendChat, input),
  workChat: (input) => ipcRenderer.invoke(channels.workChat, input),
  workItemDetail: (input) => ipcRenderer.invoke(channels.workItemDetail, input),
  workItemComments: (input) =>
    ipcRenderer.invoke(channels.workItemComments, input),
  addWorkComment: (input) => ipcRenderer.invoke(channels.addWorkComment, input),
  materializeWorkItem: (input) =>
    ipcRenderer.invoke(channels.materializeWorkItem, input),
  exportWorkItem: (input) => ipcRenderer.invoke(channels.exportWorkItem, input),
  taskFileDiff: (ref) => ipcRenderer.invoke(channels.taskFileDiff, ref),
  createBoardItem: (input) =>
    ipcRenderer.invoke(channels.createBoardItem, input),
  boardItem: (id) => ipcRenderer.invoke(channels.boardItem, id),
  updateBoardItem: (input) =>
    ipcRenderer.invoke(channels.updateBoardItem, input),
  moveBoardItem: (input) => ipcRenderer.invoke(channels.moveBoardItem, input),
  archiveBoardItem: (input) =>
    ipcRenderer.invoke(channels.archiveBoardItem, input),
  submitBoardItem: (input) =>
    ipcRenderer.invoke(channels.submitBoardItem, input),
  monitorSnapshot: (input) =>
    ipcRenderer.invoke(channels.monitorSnapshot, input),
  workspaces: (id) => ipcRenderer.invoke(channels.workspaces, id),
  createWorkspace: (id) => ipcRenderer.invoke(channels.createWorkspace, id),
  openWorkspace: (id) => ipcRenderer.invoke(channels.openWorkspace, id),
  recoverWorkspace: (id) => ipcRenderer.invoke(channels.recoverWorkspace, id),
  previewWorkspaceRemoval: (id) =>
    ipcRenderer.invoke(channels.previewWorkspaceRemoval, id),
  removeWorkspace: (token) =>
    ipcRenderer.invoke(channels.removeWorkspace, token),
  recovery: (id) => ipcRenderer.invoke(channels.recovery, id),
  continueRecovery: (token) =>
    ipcRenderer.invoke(channels.continueRecovery, token),
  exportRun: (id) => ipcRenderer.invoke(channels.exportRun, id),
  retention: (input) => ipcRenderer.invoke(channels.retention, input),
  prune: (token) => ipcRenderer.invoke(channels.prune, token),
  commandCatalog: (id) => ipcRenderer.invoke(channels.commandCatalog, id),
  startCommand: (input) => ipcRenderer.invoke(channels.startCommand, input),
  stopCommand: () => ipcRenderer.invoke(channels.stopCommand),
  localCommand: () => ipcRenderer.invoke(channels.localCommand),
  acceptanceEvidence: (input) =>
    ipcRenderer.invoke(channels.acceptanceEvidence, input),
  commandOutput: (input) => ipcRenderer.invoke(channels.commandOutput, input),
  evidence: (id) => ipcRenderer.invoke(channels.evidence, id),
  fileDiff: (input) => ipcRenderer.invoke(channels.fileDiff, input),
  previewRestore: (input) => ipcRenderer.invoke(channels.previewRestore, input),
  restoreFile: (token) => ipcRenderer.invoke(channels.restoreFile, token),
  revealFile: (input) => ipcRenderer.invoke(channels.revealFile, input),
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
