import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { activityLabels } from "../../shared/monitor";
import type { Role } from "../../shared/contracts";
import type { InspectorSelection } from "../../shared/inspector";
import type { MonitorState } from "../lib/monitor-store";
import {
  clampOfficePan,
  placeOfficeLabels,
  type OfficeProjection,
} from "./office/layout";
import { officeTarget, selectOffice } from "./office/state";

const OfficeScene = lazy(() => import("./office/OfficeScene"));
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function OfficeWorkspace({
  state,
  projectId,
  projectName,
  onMonitor,
  selectedRole,
  selection,
  onSelectRole,
  onInspect,
  onBoard,
}: {
  state: MonitorState;
  projectId: string;
  projectName: string;
  onMonitor: () => void;
  selectedRole: Role | null;
  selection: InspectorSelection | null;
  onSelectRole: (role: Role | null) => void;
  onInspect: (selection: InspectorSelection) => void;
  onBoard: () => void;
}) {
  const office = useMemo(
    () => selectOffice(state, projectId),
    [state, projectId],
  );
  const [view, setView] = useState({ scale: 1, x: 0, z: 0, reset: 0 });
  const [lost, setLost] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const activity = useRef<HTMLDetailsElement>(null);
  const [hoveredRole, setHoveredRole] = useState<Role | null>(null);
  const chooseRole = useCallback(
    (role: Role) => {
      onSelectRole(role);
      if (activity.current) activity.current.open = true;
    },
    [onSelectRole],
  );
  const hovered = office.agents.find((a) => a.role === hoveredRole);
  const visibleAgents = office.agents.filter(
    (a) => !selectedRole || a.role === selectedRole,
  );
  const activityCount = visibleAgents.reduce(
    (n, a) => n + a.executions.length,
    0,
  );
  const waitingCount = visibleAgents.reduce((n, a) => n + a.waiting.length, 0);
  const preview = hovered
    ? `${hovered.role === "lead" ? "Lead" : hovered.role.toUpperCase()} · ${hovered.executions.length === 1 ? hovered.executions[0].title : hovered.label}`
    : "Kéo để dịch chuyển · Cuộn để thu phóng";
  function inspect(
    role: Role,
    target: { executionId: string } | { taskId: string },
  ) {
    const selection = officeTarget(state, projectId, role, target);
    if (selection) onInspect(selection);
  }
  const markLost = useCallback(() => setLost(true), []);
  const syncView = useCallback(
    (actual: { scale: number; x: number; z: number }) => {
      setView((old) => ({ ...old, ...actual }));
    },
    [],
  );
  const markReady = useCallback(() => {
    if (stage.current) stage.current.dataset.ready = "true";
  }, []);
  const projectLabels = useCallback((projection: OfficeProjection[]) => {
    if (!stage.current) return;
    const placed = placeOfficeLabels(
      projection.map((item) => {
        const label = labels.current.get(item.role);
        return {
          ...item,
          width: label?.offsetWidth ?? 0,
          height: label?.offsetHeight ?? 0,
        };
      }),
      stage.current.clientWidth,
      stage.current.clientHeight,
    );
    for (const item of placed) {
      const label = labels.current.get(item.role);
      if (label) {
        label.style.left = `${item.x}px`;
        label.style.top = `${item.y}px`;
        label.style.visibility = item.visible ? "visible" : "hidden";
      }
    }
  }, []);
  function pan(x: number, z: number) {
    setView((old) => ({
      ...old,
      x: clampOfficePan(old.x + x),
      z: clampOfficePan(old.z + z),
    }));
  }
  const unavailable = (
    <div className="office-fallback" role="status">
      3D chưa khả dụng <button onClick={onMonitor}>Mở đội ngũ 2D</button>
    </div>
  );
  return (
    <section className="office-workspace" aria-label="Văn phòng agent">
      <div className="page-heading">
        <div>
          <h1>Văn phòng</h1>
          <span className="muted">{projectName}</span>
        </div>
        <div className="ui-cluster">
          <button onClick={onBoard}>Công việc</button>
          <button onClick={onMonitor}>Đội ngũ 2D</button>
        </div>
      </div>
      {!office.reliable && !state.error && (
        <p className="notice" role="status">
          Chưa đồng bộ trạng thái
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {office.otherProject && (
        <p className="notice" role="status">
          Đang chạy ở dự án: {office.otherProject}
        </p>
      )}
      <div className="office-status" aria-label="Trạng thái công việc">
        <span>
          <strong>{office.busy ?? "—"}</strong> agent bận
        </span>
        <span>
          <strong>{office.executions ?? "—"}</strong> tác vụ
        </span>
        <span>
          <strong>{office.waiting ?? "—"}</strong> chờ
        </span>
        <span className="office-progress">
          Đã xác minh{" "}
          <strong>
            {office.progress
              ? `${office.progress.verifiedTasks}/${office.progress.currentTasks}`
              : "—"}
          </strong>
        </span>
      </div>
      <div className="office-toolbar" aria-label="Góc nhìn văn phòng">
        <div className="ui-cluster">
          <button
            aria-label="Thu nhỏ văn phòng"
            disabled={view.scale <= 0.7}
            onClick={() =>
              setView((old) => ({
                ...old,
                scale: Math.max(0.7, old.scale - 0.2),
              }))
            }
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="Phóng to văn phòng"
            disabled={view.scale >= 2.4}
            onClick={() =>
              setView((old) => ({
                ...old,
                scale: Math.min(2.4, old.scale + 0.2),
              }))
            }
          >
            <Plus size={15} />
          </button>
          <button
            aria-label="Dịch góc nhìn sang trái"
            onClick={() => pan(-1, 0)}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            aria-label="Dịch góc nhìn sang phải"
            onClick={() => pan(1, 0)}
          >
            <ArrowRight size={15} />
          </button>
          <button aria-label="Dịch góc nhìn lên" onClick={() => pan(0, -1)}>
            <ArrowUp size={15} />
          </button>
          <button aria-label="Dịch góc nhìn xuống" onClick={() => pan(0, 1)}>
            <ArrowDown size={15} />
          </button>
          <button
            onClick={() =>
              setView((old) => ({ scale: 1, x: 0, z: 0, reset: old.reset + 1 }))
            }
          >
            <RotateCcw size={14} />
            Đặt lại góc nhìn
          </button>
        </div>
        <span className="muted office-stage-label">7 vị trí</span>
      </div>
      <div
        className="office-stage"
        data-selected-role={selectedRole ?? ""}
        data-hovered-role={hoveredRole ?? ""}
        ref={stage}
        aria-label="Phòng 3D bảy vị trí agent"
      >
        {lost ? (
          unavailable
        ) : (
          <SceneBoundary fallback={unavailable} onFailure={markLost}>
            <Suspense
              fallback={
                <p className="office-loading" role="status">
                  Đang tải văn phòng…
                </p>
              }
            >
              <OfficeScene
                selectedRole={selectedRole}
                hoveredRole={hoveredRole}
                onSelectRole={chooseRole}
                onHoverRole={setHoveredRole}
                agents={office.agents}
                view={view}
                onProjection={projectLabels}
                onLost={markLost}
                onReady={markReady}
                onView={syncView}
              />
            </Suspense>
          </SceneBoundary>
        )}
        {!lost && (
          <div className="office-labels" aria-label="Chọn agent">
            {office.agents.map(({ role, label, tone, executions }) => {
              return (
                <button
                  type="button"
                  className="office-seat-label"
                  key={role}
                  data-role={role}
                  data-tone={tone}
                  data-executions={executions.length}
                  aria-pressed={selectedRole === role}
                  aria-label={`${role === "lead" ? "Lead" : role.toUpperCase()} · ${label}`}
                  aria-controls="office-activity"
                  onClick={() => chooseRole(role)}
                  onMouseEnter={() => setHoveredRole(role)}
                  onMouseLeave={() => setHoveredRole(null)}
                  onFocus={() => setHoveredRole(role)}
                  onBlur={() => setHoveredRole(null)}
                  title={executions.length === 1 ? executions[0].title : label}
                  ref={(el) => {
                    if (el) labels.current.set(role, el);
                    else labels.current.delete(role);
                  }}
                >
                  <strong>
                    {role === "lead" ? "Lead" : role.toUpperCase()}
                  </strong>
                  <small>{label}</small>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="office-caption" title={preview}>
        {preview}
      </p>
      <details
        className="office-activity"
        id="office-activity"
        ref={activity}
        open={selectedRole ? true : undefined}
      >
        <summary>
          Hoạt động
          {selectedRole &&
            ` · ${selectedRole === "lead" ? "Lead" : selectedRole.toUpperCase()}`}
          {office.reliable
            ? ` · ${activityCount} tác vụ · ${waitingCount} chờ`
            : " · Chưa đồng bộ"}
        </summary>
        {selectedRole && (
          <div className="office-selection">
            <span>
              {office.agents.find((a) => a.role === selectedRole)?.label}
            </span>
            <button onClick={() => onSelectRole(null)}>Bỏ chọn agent</button>
          </div>
        )}
        <div className="office-activity-list" aria-label="Hoạt động theo agent">
          {!office.reliable ? (
            <p className="muted">Chưa đồng bộ trạng thái</p>
          ) : !activityCount && !waitingCount ? (
            <p className="muted">Không có tác vụ đang chạy hoặc chờ.</p>
          ) : (
            visibleAgents
              .filter((a) => a.executions.length || a.waiting.length)
              .map((agent) => (
                <section key={agent.role} aria-label={agent.role.toUpperCase()}>
                  <h2>
                    {agent.role === "lead" ? "Lead" : agent.role.toUpperCase()}
                  </h2>
                  <ul>
                    {agent.executions.map((execution) => (
                      <li
                        key={execution.executionId}
                        data-execution={execution.executionId}
                      >
                        <button
                          className="office-task-link"
                          aria-current={
                            selection?.projectId === projectId &&
                            selection.runId === execution.runId &&
                            (selection.taskId ?? null) === execution.taskId &&
                            (!selection.executionId ||
                              selection.executionId === execution.executionId)
                              ? "true"
                              : undefined
                          }
                          onClick={() =>
                            inspect(agent.role, {
                              executionId: execution.executionId,
                            })
                          }
                        >
                          <strong>{execution.title}</strong>
                        </button>
                        <span>
                          {activityLabels[execution.activity]} ·{" "}
                          {execution.model || "Chưa có model"}
                        </span>
                      </li>
                    ))}
                    {agent.waiting.map((task) => (
                      <li key={task.taskId} data-waiting={task.taskId}>
                        <button
                          className="office-task-link"
                          aria-current={
                            selection?.projectId === projectId &&
                            selection.runId === state.snapshot?.runId &&
                            selection.taskId === task.taskId
                              ? "true"
                              : undefined
                          }
                          onClick={() =>
                            inspect(agent.role, { taskId: task.taskId })
                          }
                        >
                          <strong>{task.title}</strong>
                        </button>
                        <span>{task.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>
      </details>
    </section>
  );
}
