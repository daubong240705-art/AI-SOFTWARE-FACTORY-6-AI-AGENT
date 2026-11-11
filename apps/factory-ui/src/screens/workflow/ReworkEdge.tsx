import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

export function ReworkEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, label }: EdgeProps) {
  const below = Math.max(sourceY, targetY) + 110;
  const path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${below}, ${targetX - 70} ${below}, ${targetX} ${targetY}`;
  return <><BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})} className="!stroke-muted-foreground [stroke-dasharray:6_5]" />
    <EdgeLabelRenderer><span className="pointer-events-none absolute rounded border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px,${(sourceY + targetY) / 2 + 82.5}px)` }}>{label}</span></EdgeLabelRenderer>
  </>;
}
