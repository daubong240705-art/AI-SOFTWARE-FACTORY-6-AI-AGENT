import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./ui/tokens.css";
import "./styles.css";
import "./chat.css";
import "./monitor.css";
import "./kanban.css";
import "./inspector.css";
import "./ui/base.css";
import "./ui/select.css";
import "./office.css";
import type { WorkerAPI } from "../shared/contracts";

declare global {
  interface Window {
    worker: WorkerAPI;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
