import { buildLegacyBoardSpec } from "@secret-toaster/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Stage, Text } from "react-konva";

import { buildBoardLayout } from "./hex-layout";
import { getHexSnapshot } from "./state";

const LEGACY_BOARD = buildLegacyBoardSpec();

function hexStyle(type: string): { fill: string; stroke: string; label: string } {
  if (type === "CASTLE") return { fill: "#fde68a", stroke: "#d97706", label: "C" };
  if (type === "KEEP") return { fill: "#bae6fd", stroke: "#0284c7", label: "K" };
  if (type === "LAND") return { fill: "#bbf7d0", stroke: "#10b981", label: "" };
  return { fill: "#e5e7eb", stroke: "#cbd5e1", label: "" };
}

function shortId(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

export interface LegacyBoardCanvasProps {
  currentState: Record<string, unknown>;
  selectedHexId: number;
  onSelectHex: (hexId: number) => void;
}

export function LegacyBoardCanvas(props: LegacyBoardCanvasProps) {
  const { currentState, selectedHexId, onSelectHex } = props;
  const layout = useMemo(() => buildBoardLayout({ boardSpec: LEGACY_BOARD, radius: 34, padding: 24 }), []);
  const hexByIndex = useMemo(() => new Map(layout.hexes.map((hex) => [hex.index, hex])), [layout.hexes]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [hoverHexId, setHoverHexId] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const refreshSize = () => {
      setContainerWidth(Math.max(320, element.clientWidth));
    };

    refreshSize();
    const observer = new ResizeObserver(refreshSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = Math.min(containerWidth / layout.width, 1);
  const scale = fitScale * zoomLevel;
  const stageHeight = Math.ceil(layout.height * scale);
  const groupX = Math.floor((containerWidth - layout.width * scale) / 2);
  const activeHexId = hoverHexId ?? selectedHexId;
  const neighborHexIds =
    activeHexId === null
      ? []
      : (hexByIndex
          .get(activeHexId)
          ?.neighbors.filter((neighbor): neighbor is number => neighbor !== null) ?? []);
  const isHighlighted = (hexId: number): boolean => hexId === selectedHexId || neighborHexIds.includes(hexId);
  const canZoomIn = zoomLevel < 2;
  const canZoomOut = zoomLevel > 0.65;

  const increaseZoom = () => setZoomLevel((current) => Math.min(2, Number((current + 0.1).toFixed(2))));
  const decreaseZoom = () => setZoomLevel((current) => Math.max(0.65, Number((current - 0.1).toFixed(2))));
  const resetZoom = () => setZoomLevel(1);

  return (
    <div ref={wrapperRef} className="w-full rounded-lg border bg-muted/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {hoverHexId === null ? "Hover a hex to preview adjacency" : `Hovering #${hoverHexId}`}
        </p>
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={decreaseZoom}
            disabled={!canZoomOut}
            className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            -
          </button>
          <span className="min-w-14 text-center font-medium">{Math.round(zoomLevel * 100)}%</span>
          <button
            type="button"
            onClick={increaseZoom}
            disabled={!canZoomIn}
            className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>
          <button type="button" onClick={resetZoom} className="rounded border px-2 py-1">
            Reset
          </button>
        </div>
      </div>
      <Stage width={containerWidth} height={stageHeight}>
        <Layer>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {layout.hexes.map((hex) => {
              const style = hexStyle(hex.type);
              const highlighted = isHighlighted(hex.index);
              const isSelected = hex.index === selectedHexId;
              return (
                <Line
                  key={hex.index}
                  points={hex.points}
                  closed
                  fill={style.fill}
                  stroke={highlighted ? "#0f766e" : style.stroke}
                  strokeWidth={isSelected ? 2.8 : highlighted ? 2.2 : 1.5}
                  opacity={hex.type === "BLANK" && !highlighted ? 0.9 : 0.98}
                  onClick={() => onSelectHex(hex.index)}
                  onTap={() => onSelectHex(hex.index)}
                  onMouseEnter={() => setHoverHexId(hex.index)}
                  onMouseLeave={() => setHoverHexId((current) => (current === hex.index ? null : current))}
                />
              );
            })}
          </Group>
        </Layer>

        <Layer listening={false}>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {layout.hexes.map((hex) => {
              const style = hexStyle(hex.type);
              const snapshot = getHexSnapshot(currentState, hex.index);

              return (
                <Group key={hex.index}>
                  <Text
                    x={hex.cx - 24}
                    y={hex.cy - 12}
                    width={48}
                    align="center"
                    fontSize={13}
                    fontStyle="600"
                    fill="#0f172a"
                    text={`#${hex.index}`}
                  />
                  {style.label ? (
                    <Text
                      x={hex.cx - 10}
                      y={hex.cy + 2}
                      width={20}
                      align="center"
                      fontSize={12}
                      fill="#0f172a"
                      text={style.label}
                    />
                  ) : null}

                  {snapshot?.ownerUserId ? (
                    <Text
                      x={hex.cx - 22}
                      y={hex.cy - 30}
                      width={44}
                      align="center"
                      fontSize={10}
                      fill="#1d4ed8"
                      text={shortId(snapshot.ownerUserId)}
                    />
                  ) : null}

                  {snapshot && snapshot.troopCount !== null ? (
                    <Group>
                      <Circle x={hex.cx} y={hex.cy + 23} radius={11} fill="#111827" opacity={0.9} />
                      <Text
                        x={hex.cx - 16}
                        y={hex.cy + 17}
                        width={32}
                        align="center"
                        fontSize={10}
                        fill="#f9fafb"
                        text={`T${snapshot.troopCount}`}
                      />
                    </Group>
                  ) : null}

                  {snapshot && snapshot.knightCount !== null ? (
                    <Group>
                      <Circle x={hex.cx + 21} y={hex.cy + 23} radius={9} fill="#0f766e" opacity={0.95} />
                      <Text
                        x={hex.cx + 11}
                        y={hex.cy + 18}
                        width={20}
                        align="center"
                        fontSize={9}
                        fill="#ecfeff"
                        text={`K${snapshot.knightCount}`}
                      />
                    </Group>
                  ) : null}
                </Group>
              );
            })}
          </Group>
        </Layer>

        <Layer listening={false}>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {layout.hexes
              .filter((hex) => hex.index === selectedHexId)
              .map((hex) => (
                <Line
                  key={hex.index}
                  points={hex.points}
                  closed
                  fill="rgba(37, 99, 235, 0.08)"
                  stroke="#2563eb"
                  strokeWidth={3}
                  shadowBlur={8}
                  shadowColor="#2563eb"
                />
              ))}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}

export { LEGACY_BOARD };
