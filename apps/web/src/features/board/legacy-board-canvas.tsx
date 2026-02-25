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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);

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

  const scale = Math.min(containerWidth / layout.width, 1);
  const stageHeight = Math.ceil(layout.height * scale);
  const groupX = Math.floor((containerWidth - layout.width * scale) / 2);

  return (
    <div ref={wrapperRef} className="w-full rounded-lg border bg-muted/20 p-2">
      <Stage width={containerWidth} height={stageHeight}>
        <Layer>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {layout.hexes.map((hex) => {
              const style = hexStyle(hex.type);
              return (
                <Line
                  key={hex.index}
                  points={hex.points}
                  closed
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={1.5}
                  opacity={selectedHexId === hex.index ? 1 : 0.95}
                  onClick={() => onSelectHex(hex.index)}
                  onTap={() => onSelectHex(hex.index)}
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
