import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BoxGeometry, MOUSE, OrthographicCamera, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  clampOfficePan,
  officeSeats,
  officeZoom,
  type OfficeProjection,
} from "./layout";

type Props = {
  view: { scale: number; x: number; z: number; reset: number };
  onProjection: (projection: OfficeProjection[]) => void;
  onLost: () => void;
  onReady: () => void;
  onView: (actual: { scale: number; x: number; z: number }) => void;
};
function CameraRig({ view, onProjection, onLost, onReady, onView }: Props) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useMemo(() => new OrbitControls(camera), [camera]);
  useEffect(() => {
    controls.enableRotate = false;
    controls.connect(gl.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = false;
    controls.mouseButtons.LEFT = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.PAN;
    const changed = () => {
      const correction = new Vector3(
        clampOfficePan(controls.target.x) - controls.target.x,
        0,
        clampOfficePan(controls.target.z) - controls.target.z,
      );
      controls.target.add(correction);
      camera.position.add(correction);
      invalidate();
    };
    controls.addEventListener("change", changed);
    const ended = () =>
      onView({
        scale:
          (camera as OrthographicCamera).zoom /
          officeZoom(gl.domElement.clientWidth, gl.domElement.clientHeight),
        x: controls.target.x,
        z: controls.target.z,
      });
    controls.addEventListener("end", ended);
    const lost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      controls.removeEventListener("change", changed);
      controls.removeEventListener("end", ended);
      controls.dispose();
      gl.domElement.removeEventListener("webglcontextlost", lost);
    };
  }, [controls, camera, gl, invalidate, onLost, onView]);
  useEffect(() => {
    const ortho = camera as OrthographicCamera;
    camera.position.set(16 + view.x, 19, 21 + view.z);
    controls.target.set(view.x, 0, view.z);
    camera.lookAt(controls.target);
    ortho.zoom = officeZoom(size.width, size.height, view.scale);
    controls.minZoom = officeZoom(size.width, size.height, 0.7);
    controls.maxZoom = officeZoom(size.width, size.height, 2.4);
    ortho.updateProjectionMatrix();
    controls.update();
    invalidate();
  }, [camera, controls, size.width, size.height, view, invalidate]);
  useFrame(() => {
    // Demand rendering can have a single frame after a camera change. Project
    // labels against this frame's camera, not the previous rendered matrix.
    camera.updateMatrixWorld();
    onProjection(
      officeSeats.map(({ role, x, z }) => {
        const projected = new Vector3(x, 2.25, z).project(camera);
        return {
          role,
          x: ((projected.x + 1) * size.width) / 2,
          y: ((1 - projected.y) * size.height) / 2,
          visible: Math.abs(projected.x) < 0.96 && Math.abs(projected.y) < 0.96,
        };
      }),
    );
    onReady();
  });
  return null;
}
function Furniture() {
  const cube = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useEffect(() => () => cube.dispose(), [cube]);
  const box = (
    key: string,
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
  ) => (
    <mesh key={key} geometry={cube} position={position} scale={scale}>
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
  return (
    <>
      {box("floor", [0, -0.18, 0], [14.8, 0.3, 13.6], "#35363c")}
      {box("rug", [0, -0.015, 0.6], [12.8, 0.025, 11], "#45474b")}
      {box("back-wall", [0, 0.55, -6.6], [14.8, 1.4, 0.18], "#656065")}
      {box("left-wall", [-7.3, 0.4, 0], [0.18, 1.1, 13.2], "#53545c")}
      {box("shelf", [-5.8, 0.7, -5.6], [2, 1.4, 0.7], "#786d60")}
      {box("shelf-inner", [-5.8, 0.9, -5.15], [1.7, 0.6, 0.05], "#33383f")}
      {box("plant-pot", [5.8, 0.3, -5.4], [0.6, 0.6, 0.6], "#ad8870")}
      {box("plant", [5.8, 1.1, -5.4], [0.85, 1.2, 0.85], "#688974")}
      {officeSeats.map(({ role, x, z, color }) => (
        <group key={role} position={[x, 0, z]}>
          {box(
            "mat",
            [0, 0.025, 0.3],
            [3.3, 0.035, 3.3],
            role === "lead" ? "#766051" : "#55565b",
          )}
          {box("top", [0, 0.95, 0], [2.6, 0.16, 1.25], "#ae9681")}
          {box("leg-l", [-1.04, 0.45, 0], [0.12, 0.9, 0.9], "#45434a")}
          {box("leg-r", [1.04, 0.45, 0], [0.12, 0.9, 0.9], "#45434a")}
          {box("screen", [0, 1.44, -0.2], [1, 0.65, 0.12], "#282e38")}
          {box("display", [0, 1.44, -0.125], [0.85, 0.48, 0.02], color)}
          {box("stand", [0, 1.1, -0.2], [0.12, 0.25, 0.12], "#333840")}
          {box("keyboard", [0, 1.05, 0.3], [0.7, 0.045, 0.25], "#383b43")}
          {box("chair", [0, 0.42, 1.1], [0.85, 0.15, 0.85], "#383d47")}
          {box("chair-back", [0, 0.85, 1.48], [0.85, 0.9, 0.15], "#383d47")}
          {box("body", [0, 0.87, 1.05], [0.55, 0.7, 0.4], color)}
          {box("head", [0, 1.48, 1.0], [0.44, 0.44, 0.44], "#dfbfa3")}
          {box("hair", [0, 1.69, 1.01], [0.47, 0.13, 0.47], "#55443f")}
        </group>
      ))}
    </>
  );
}
export default function OfficeScene(props: Props) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [16, 19, 21], near: 0.1, far: 150 }}
      gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
      fallback={
        <p className="office-fallback">3D chưa khả dụng · Dùng Đội ngũ 2D</p>
      }
    >
      <color attach="background" args={["#202126"]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[5, 12, 8]} intensity={2.2} />
      <Furniture />
      <CameraRig {...props} />
    </Canvas>
  );
}
