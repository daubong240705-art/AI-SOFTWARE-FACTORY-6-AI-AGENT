import {
  Component,
  lazy,
  Suspense,
  useCallback,
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
import { availabilityLabels } from "../../shared/monitor";
import type { MonitorState } from "../lib/monitor-store";
import {
  clampOfficePan,
  officeSeats,
  type OfficeProjection,
} from "./office/layout";

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
  projectName,
  onMonitor,
}: {
  state: MonitorState;
  projectName: string;
  onMonitor: () => void;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, z: 0, reset: 0 });
  const [lost, setLost] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLSpanElement>());
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
    for (const item of projection) {
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
        <button onClick={onMonitor}>Đội ngũ 2D</button>
      </div>
      {state.stale && (
        <p className="notice" role="status">
          Chưa đồng bộ · Đang hiển thị trạng thái lần cuối
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
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
          <div className="office-labels" aria-hidden="true">
            {officeSeats.map(({ role }) => {
              const agent = state.snapshot?.agents.find(
                (item) => item.role === role,
              );
              return (
                <span
                  className="office-seat-label"
                  key={role}
                  ref={(el) => {
                    if (el) labels.current.set(role, el);
                    else labels.current.delete(role);
                  }}
                >
                  <strong>
                    {role === "lead" ? "Lead" : role.toUpperCase()}
                  </strong>
                  <small>
                    {state.stale || !agent
                      ? "Chưa đồng bộ"
                      : availabilityLabels[agent.availability]}
                  </small>
                </span>
              );
            })}
          </div>
        )}
      </div>
      <p className="office-caption">Kéo để dịch chuyển · Cuộn để thu phóng</p>
    </section>
  );
}
