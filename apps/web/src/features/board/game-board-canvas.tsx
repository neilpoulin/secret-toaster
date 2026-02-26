import { buildLegacyBoardSpec } from "@secret-toaster/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";

import { Button } from "@/components/ui/button";

import { buildBoardLayout } from "./hex-layout";
import { getHexSnapshot } from "./state";

const LEGACY_BOARD = buildLegacyBoardSpec();

interface HexVisualStyle {
  fill: string;
  stroke: string;
  label: string;
  idFill: string;
  labelFill: string;
  shadowColor: string;
  shadowBlur: number;
  fillOpacity: number;
}

interface BoardPalette {
  stageBg: string;
  landFill: string;
  landStroke: string;
  keepFill: string;
  keepStroke: string;
  castleFill: string;
  castleStroke: string;
  blankFill: string;
  blankStroke: string;
  text: string;
  textMuted: string;
  label: string;
  ownerText: string;
  neighborFill: string;
  neighborStroke: string;
  selectedFill: string;
  selectedStroke: string;
  activeFill: string;
  activeStroke: string;
  fromFill: string;
  fromStroke: string;
  toFill: string;
  toStroke: string;
  troopsBadgeBg: string;
  troopsBadgeText: string;
  knightsBadgeBg: string;
  knightsBadgeText: string;
}

const DEFAULT_PALETTE: BoardPalette = {
  stageBg: "#f8fafc",
  landFill: "#86efac",
  landStroke: "#059669",
  keepFill: "#7dd3fc",
  keepStroke: "#0369a1",
  castleFill: "#facc15",
  castleStroke: "#b45309",
  blankFill: "#e5e7eb",
  blankStroke: "#cbd5e1",
  text: "#0f172a",
  textMuted: "#475569",
  label: "#1f2937",
  ownerText: "#1d4ed8",
  neighborFill: "#bfdbfe",
  neighborStroke: "#1d4ed8",
  selectedFill: "#93c5fd",
  selectedStroke: "#1e40af",
  activeFill: "#60a5fa",
  activeStroke: "#1e3a8a",
  fromFill: "#fdba74",
  fromStroke: "#c2410c",
  toFill: "#c4b5fd",
  toStroke: "#6d28d9",
  troopsBadgeBg: "#111827",
  troopsBadgeText: "#f9fafb",
  knightsBadgeBg: "#0f766e",
  knightsBadgeText: "#ecfeff",
};

function readBoardPalette(): BoardPalette {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  const styles = window.getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };

  return {
    stageBg: cssVar("--board-stage-bg", DEFAULT_PALETTE.stageBg),
    landFill: cssVar("--board-land-fill", DEFAULT_PALETTE.landFill),
    landStroke: cssVar("--board-land-stroke", DEFAULT_PALETTE.landStroke),
    keepFill: cssVar("--board-keep-fill", DEFAULT_PALETTE.keepFill),
    keepStroke: cssVar("--board-keep-stroke", DEFAULT_PALETTE.keepStroke),
    castleFill: cssVar("--board-castle-fill", DEFAULT_PALETTE.castleFill),
    castleStroke: cssVar("--board-castle-stroke", DEFAULT_PALETTE.castleStroke),
    blankFill: cssVar("--board-blank-fill", DEFAULT_PALETTE.blankFill),
    blankStroke: cssVar("--board-blank-stroke", DEFAULT_PALETTE.blankStroke),
    text: cssVar("--board-text", DEFAULT_PALETTE.text),
    textMuted: cssVar("--board-text-muted", DEFAULT_PALETTE.textMuted),
    label: cssVar("--board-label", DEFAULT_PALETTE.label),
    ownerText: cssVar("--board-owner-text", DEFAULT_PALETTE.ownerText),
    neighborFill: cssVar("--board-state-neighbor-fill", DEFAULT_PALETTE.neighborFill),
    neighborStroke: cssVar("--board-state-neighbor-stroke", DEFAULT_PALETTE.neighborStroke),
    selectedFill: cssVar("--board-state-selected-fill", DEFAULT_PALETTE.selectedFill),
    selectedStroke: cssVar("--board-state-selected-stroke", DEFAULT_PALETTE.selectedStroke),
    activeFill: cssVar("--board-state-active-fill", DEFAULT_PALETTE.activeFill),
    activeStroke: cssVar("--board-state-active-stroke", DEFAULT_PALETTE.activeStroke),
    fromFill: cssVar("--board-state-from-fill", DEFAULT_PALETTE.fromFill),
    fromStroke: cssVar("--board-state-from-stroke", DEFAULT_PALETTE.fromStroke),
    toFill: cssVar("--board-state-to-fill", DEFAULT_PALETTE.toFill),
    toStroke: cssVar("--board-state-to-stroke", DEFAULT_PALETTE.toStroke),
    troopsBadgeBg: cssVar("--board-badge-troops-bg", DEFAULT_PALETTE.troopsBadgeBg),
    troopsBadgeText: cssVar("--board-badge-troops-text", DEFAULT_PALETTE.troopsBadgeText),
    knightsBadgeBg: cssVar("--board-badge-knights-bg", DEFAULT_PALETTE.knightsBadgeBg),
    knightsBadgeText: cssVar("--board-badge-knights-text", DEFAULT_PALETTE.knightsBadgeText),
  };
}

function hexStyle(type: string, palette: BoardPalette): HexVisualStyle {
  if (type === "CASTLE") {
    return {
      fill: palette.castleFill,
      stroke: palette.castleStroke,
      label: "C",
      idFill: palette.label,
      labelFill: palette.label,
      shadowColor: palette.castleStroke,
      shadowBlur: 4,
      fillOpacity: 0.88,
    };
  }

  if (type === "KEEP") {
    return {
      fill: palette.keepFill,
      stroke: palette.keepStroke,
      label: "K",
      idFill: palette.text,
      labelFill: palette.text,
      shadowColor: palette.keepStroke,
      shadowBlur: 4,
      fillOpacity: 0.86,
    };
  }

  if (type === "LAND") {
    return {
      fill: palette.landFill,
      stroke: palette.landStroke,
      label: "",
      idFill: palette.text,
      labelFill: palette.text,
      shadowColor: palette.landStroke,
      shadowBlur: 3,
      fillOpacity: 0.82,
    };
  }

  return {
    fill: palette.blankFill,
    stroke: palette.blankStroke,
    label: "",
    idFill: palette.textMuted,
    labelFill: palette.textMuted,
    shadowColor: palette.blankStroke,
    shadowBlur: 1.5,
    fillOpacity: 0.72,
  };
}

function shortId(value: string): string {
  const maxLength = 8;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export interface GameBoardCanvasProps {
  currentState: Record<string, unknown>;
  playbackState?: Record<string, unknown> | null;
  selectedHexId: number;
  plannedFromHexId?: number | null;
  plannedToHexId?: number | null;
  legalDestinationHexIds?: number[];
  playerColors?: Record<string, string>;
  playerDisplayNames?: Record<string, string>;
  playbackStep?: {
    fromHexId: number;
    toHexId: number;
    playerUserId: string;
    label: string;
  } | null;
  onSelectHex: (hexId: number) => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return `rgba(255,255,255,${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function GameBoardCanvas(props: GameBoardCanvasProps) {
  const {
    currentState,
    selectedHexId,
    playbackState = null,
    plannedFromHexId = null,
    plannedToHexId = null,
    legalDestinationHexIds,
    playerColors = {},
    playerDisplayNames = {},
    playbackStep = null,
    onSelectHex,
  } = props;
  const layout = useMemo(() => buildBoardLayout({ boardSpec: LEGACY_BOARD, radius: 34, padding: 0 }), []);
  const baseHexes = useMemo(
    () =>
      [...layout.hexes].sort((left, right) => {
        const leftPriority = left.type === "BLANK" ? 0 : 1;
        const rightPriority = right.type === "BLANK" ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left.index - right.index;
      }),
    [layout.hexes],
  );
  const hexByIndex = useMemo(() => new Map(layout.hexes.map((hex) => [hex.index, hex])), [layout.hexes]);
  const isPlayableHex = (hexIndex: number): boolean => {
    const hex = hexByIndex.get(hexIndex);
    return Boolean(hex && hex.type !== "BLANK");
  };
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [hoverHexId, setHoverHexId] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [palette, setPalette] = useState<BoardPalette>(DEFAULT_PALETTE);

  useEffect(() => {
    const updatePalette = () => setPalette(readBoardPalette());
    updatePalette();

    const observer = new MutationObserver(() => updatePalette());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    return () => observer.disconnect();
  }, []);

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
  const renderState = playbackState ?? currentState;
  const scale = fitScale * zoomLevel;
  const stageHeight = Math.ceil(layout.height * scale);
  const groupX = Math.floor((containerWidth - layout.width * scale) / 2);
  const activeHexId = hoverHexId ?? selectedHexId;
  const neighborHexIds =
    legalDestinationHexIds && legalDestinationHexIds.length > 0
      ? legalDestinationHexIds
      : activeHexId === null
        ? []
        : (hexByIndex
            .get(activeHexId)
            ?.neighbors.filter((neighbor): neighbor is number => neighbor !== null && isPlayableHex(neighbor)) ?? []);
  const neighborHexSet = useMemo(() => new Set(neighborHexIds), [neighborHexIds]);
  const canZoomIn = zoomLevel < 2;
  const canZoomOut = zoomLevel > 0.65;

  const increaseZoom = () => setZoomLevel((current) => Math.min(2, Number((current + 0.1).toFixed(2))));
  const decreaseZoom = () => setZoomLevel((current) => Math.max(0.65, Number((current - 0.1).toFixed(2))));
  const resetZoom = () => setZoomLevel(1);
  const ownerLabelForUser = (userId: string): string => {
    const displayName = playerDisplayNames[userId]?.trim();
    if (displayName && displayName.length > 0) {
      const maxLength = 14;
      return displayName.length <= maxLength ? displayName : `${displayName.slice(0, maxLength)}...`;
    }

    return shortId(userId);
  };

  return (
    <div ref={wrapperRef} className="w-full overflow-hidden rounded-lg border border-border bg-card/80">
      <div className="flex items-center justify-between gap-2 border-b bg-muted px-3 py-2 text-foreground">
        <p className="text-sm font-medium text-muted-foreground">
          {hoverHexId === null ? "Hover a hex to preview adjacency" : `Hovering #${hoverHexId}`}
        </p>
        <div className="flex items-center gap-1.5 text-xs">
          <Button type="button" variant="outline" size="icon-xs" onClick={decreaseZoom} disabled={!canZoomOut}>
            -
          </Button>
          <span className="min-w-14 text-center text-sm font-semibold text-foreground">{Math.round(zoomLevel * 100)}%</span>
          <Button type="button" variant="outline" size="icon-xs" onClick={increaseZoom} disabled={!canZoomIn}>
            +
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={resetZoom}>
            Reset
          </Button>
        </div>
      </div>
      <Stage width={containerWidth} height={stageHeight}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={containerWidth} height={stageHeight} fill={palette.stageBg} />
        </Layer>

        <Layer>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {baseHexes.map((hex) => {
              const style = hexStyle(hex.type, palette);
              const isPlayable = hex.type !== "BLANK";
              const isNeighbor = neighborHexSet.has(hex.index);
              const isSelected = hex.index === selectedHexId;
              const isActive = hex.index === activeHexId;
              const isPlannedFrom = plannedFromHexId === hex.index;
              const isPlannedTo = plannedToHexId === hex.index;
              const isHovered = hoverHexId === hex.index;

              let tileFill = style.fill;
              let tileFillOpacity = style.fillOpacity;
              let tileStroke = style.stroke;
              let tileStrokeWidth = 1.4;
              let tileOpacity = hex.type === "BLANK" ? 0.8 : 1;

              const ownership = getHexSnapshot(renderState, hex.index);
              const ownerColor = ownership?.ownerUserId ? playerColors[ownership.ownerUserId] : undefined;

              if (!isPlayable) {
                tileOpacity = hoverHexId === null ? 0.78 : 0.35;
              } else if (ownerColor) {
                tileFill = hexToRgba(ownerColor, 0.22);
                tileFillOpacity = 1;
                tileStroke = ownerColor;
                tileStrokeWidth = 1.8;
              }

              if (isNeighbor) {
                tileFill = palette.neighborFill;
                tileFillOpacity = 0.84;
                tileStroke = palette.neighborStroke;
                tileStrokeWidth = 2.4;
                tileOpacity = 1;
              }

              if (isSelected) {
                tileFill = palette.selectedFill;
                tileFillOpacity = 0.9;
                tileStroke = palette.selectedStroke;
                tileStrokeWidth = 3;
                tileOpacity = 1;
              }

              if (isActive) {
                tileFill = palette.activeFill;
                tileFillOpacity = 0.95;
                tileStroke = palette.activeStroke;
                tileStrokeWidth = 3.2;
                tileOpacity = 1;
              }

              if (isPlannedFrom) {
                tileFill = palette.fromFill;
                tileFillOpacity = 0.92;
                tileStroke = palette.fromStroke;
                tileStrokeWidth = 3.2;
                tileOpacity = 1;
              }

              if (isPlannedTo) {
                tileFill = palette.toFill;
                tileFillOpacity = 0.92;
                tileStroke = palette.toStroke;
                tileStrokeWidth = 3.2;
                tileOpacity = 1;
              }

              if (hoverHexId !== null && !isActive && !isNeighbor) {
                tileOpacity = hex.type === "BLANK" ? 0.42 : 0.5;
              }

              return (
                <Line
                  key={hex.index}
                  points={hex.points}
                  closed
                  fill={tileFill}
                  fillOpacity={tileFillOpacity}
                  stroke={tileStroke}
                  strokeWidth={tileStrokeWidth}
                  opacity={tileOpacity}
                  shadowColor={style.shadowColor}
                  shadowBlur={isActive ? 9 : isSelected ? 8 : isHovered ? style.shadowBlur + 3 : style.shadowBlur}
                  shadowOpacity={isActive ? 0.52 : isSelected ? 0.45 : isHovered ? 0.3 : 0.14}
                  lineJoin="round"
                  onClick={() => {
                    if (isPlayable) onSelectHex(hex.index);
                  }}
                  onTap={() => {
                    if (isPlayable) onSelectHex(hex.index);
                  }}
                  onMouseEnter={() => {
                    if (isPlayable) setHoverHexId(hex.index);
                  }}
                  onMouseLeave={() => setHoverHexId((current) => (current === hex.index ? null : current))}
                />
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
                  fillEnabled={false}
                  stroke={palette.selectedStroke}
                  strokeWidth={3}
                  shadowBlur={10}
                  shadowColor={palette.selectedStroke}
                />
              ))}

            {layout.hexes
              .filter((hex) => hex.index === activeHexId)
              .map((hex) => (
                <Line
                  key={`active-${hex.index}`}
                  points={hex.points}
                  closed
                  fillEnabled={false}
                  stroke={palette.activeStroke}
                  strokeWidth={3.2}
                />
              ))}

            {playbackStep
              ? layout.hexes
                  .filter((hex) => hex.index === playbackStep.fromHexId || hex.index === playbackStep.toHexId)
                  .map((hex) => (
                    <Line
                      key={`playback-${hex.index}`}
                      points={hex.points}
                      closed
                      fillEnabled={false}
                      stroke={hex.index === playbackStep.toHexId ? "#f59e0b" : "#fb7185"}
                      strokeWidth={3.4}
                      shadowBlur={10}
                      shadowColor={hex.index === playbackStep.toHexId ? "#f59e0b" : "#fb7185"}
                    />
                  ))
              : null}
          </Group>
        </Layer>

        <Layer listening={false}>
          <Group x={groupX} scaleX={scale} scaleY={scale}>
            {layout.hexes.map((hex) => {
              const style = hexStyle(hex.type, palette);
              const snapshot = getHexSnapshot(renderState, hex.index);
              const isActive = hex.index === activeHexId;
              const isNeighbor = neighborHexSet.has(hex.index);
              const isPlannedFrom = plannedFromHexId === hex.index;
              const isPlannedTo = plannedToHexId === hex.index;
              const textOpacity = hoverHexId !== null && !isActive && !isNeighbor ? 0.45 : 1;
              const troopCount = snapshot?.troopCount ?? 0;
              const knightCount = snapshot?.knightCount ?? 0;
              const hasTroops = troopCount > 0;
              const hasKnights = knightCount > 0;
              const hasUnitBadges = hasTroops || hasKnights;
              const showOwnerLabel = Boolean(snapshot?.ownerUserId) && (isActive || isPlannedFrom || isPlannedTo);
              const ownerLabelY = hasUnitBadges ? hex.cy - 40 : hex.cy - 32;
              const badgesY = hasUnitBadges ? hex.cy + 24 : hex.cy + 23;
              const idFill =
                isPlannedFrom
                  ? palette.fromStroke
                  : isPlannedTo
                    ? palette.toStroke
                    : isActive || isNeighbor
                      ? palette.activeStroke
                      : style.idFill;

              return (
                <Group key={hex.index}>
                  <Text
                    x={hex.cx - 24}
                    y={hex.cy - 12}
                    width={48}
                    align="center"
                    fontSize={hex.type === "BLANK" ? 11 : 13}
                    fontStyle="600"
                    fill={idFill}
                    opacity={(hex.type === "BLANK" ? 0.78 : 0.95) * textOpacity}
                    text={`#${hex.index}`}
                  />
                  {style.label ? (
                    <Text
                      x={hex.cx - 10}
                      y={hex.cy + 2}
                      width={20}
                      align="center"
                      fontSize={13}
                      fontStyle="700"
                      fill={isActive || isNeighbor ? palette.activeStroke : style.labelFill}
                      opacity={textOpacity}
                      text={style.label}
                    />
                  ) : null}

                  {isPlannedFrom ? (
                    <Text
                      x={hex.cx - 8}
                      y={hex.cy - 30}
                      width={16}
                      align="center"
                      fontSize={10}
                      fontStyle="700"
                      fill={palette.fromStroke}
                      text="S"
                    />
                  ) : null}

                  {isPlannedTo ? (
                    <Text
                      x={hex.cx - 8}
                      y={hex.cy - 30}
                      width={16}
                      align="center"
                      fontSize={10}
                      fontStyle="700"
                      fill={palette.toStroke}
                      text="D"
                    />
                  ) : null}

                  {snapshot?.ownerUserId && showOwnerLabel ? (
                    <Group>
                      {(() => {
                        const ownerColor = playerColors[snapshot.ownerUserId] ?? palette.ownerText;
                        return (
                          <>
                      <Rect
                        x={hex.cx - 36}
                        y={ownerLabelY - 2}
                        width={72}
                        height={13}
                        cornerRadius={6}
                        fill={palette.stageBg}
                        opacity={0.92 * textOpacity}
                      />
                      <Text
                        x={hex.cx - 35}
                        y={ownerLabelY}
                        width={70}
                        align="center"
                        wrap="none"
                        ellipsis
                        fontSize={9}
                        fontStyle="600"
                        fill={ownerColor}
                        opacity={textOpacity}
                        text={ownerLabelForUser(snapshot.ownerUserId)}
                      />
                          </>
                        );
                      })()}
                    </Group>
                  ) : null}

                  {hasTroops ? (
                    <Group>
                      <Circle
                        x={hex.cx}
                        y={badgesY}
                        radius={11}
                        fill={palette.troopsBadgeBg}
                        opacity={0.96}
                        stroke={palette.stageBg}
                        strokeWidth={2}
                      />
                      <Text
                        x={hex.cx - 16}
                        y={badgesY - 6}
                        width={32}
                        align="center"
                        fontSize={10}
                        fontStyle="700"
                        fill={palette.troopsBadgeText}
                        text={`T${troopCount}`}
                      />
                    </Group>
                  ) : null}

                  {hasKnights ? (
                    <Group>
                      <Circle
                        x={hasTroops ? hex.cx + 21 : hex.cx}
                        y={badgesY}
                        radius={9}
                        fill={palette.knightsBadgeBg}
                        opacity={0.98}
                        stroke={palette.stageBg}
                        strokeWidth={2}
                      />
                      <Text
                        x={hasTroops ? hex.cx + 11 : hex.cx - 10}
                        y={badgesY - 5}
                        width={20}
                        align="center"
                        fontSize={9}
                        fontStyle="700"
                        fill={palette.knightsBadgeText}
                        text={`K${knightCount}`}
                      />
                    </Group>
                  ) : null}
                </Group>
              );
            })}
          </Group>
        </Layer>

        {playbackStep ? (
          <Layer listening={false}>
            <Text x={16} y={10} fontSize={12} fill={palette.textMuted} text={`Playback: ${playbackStep.label}`} />
          </Layer>
        ) : null}
      </Stage>
    </div>
  );
}

export { LEGACY_BOARD };
