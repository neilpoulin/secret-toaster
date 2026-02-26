import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type OrderActionType, validateCommandPayload } from "@secret-toaster/contracts";
import { legacyBoardX, legacyBoardY } from "@secret-toaster/domain";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGACY_BOARD, GameBoardCanvas } from "@/features/board/game-board-canvas";
import { getHexSnapshot } from "@/features/board/state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ActiveGame, getStoredActiveGame, setStoredActiveGame } from "@/lib/active-game";
import { supabase } from "@/lib/supabase";

interface CreateInviteResponse {
  ok: boolean;
  gameId: string;
  inviteToken: string;
  expiresAt: string;
}

interface ApplyCommandResponse {
  ok: boolean;
  accepted: boolean;
  eventId: number;
  createdAt: string;
}

interface GameEventRecord {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  caused_by?: string | null;
  created_at: string;
}

interface GameDetailsRecord {
  id: string;
  game_code: string;
  title: string | null;
  status: string;
  round: number;
  current_state: Record<string, unknown>;
  created_at: string;
}

interface GameMembershipRecord {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  joined_at: string;
}

interface PlayerReadinessRecord {
  id: string;
  user_id: string;
  round: number;
  is_ready: boolean;
  updated_at: string;
}

interface ProfileRecord {
  user_id: string;
  display_name: string | null;
}

interface AllianceRecord {
  id: string;
  game_id: string;
  name: string;
  color_hex: string | null;
  created_by: string;
  created_at: string;
}

interface PlayerAllianceRecord {
  game_id: string;
  user_id: string;
  alliance_id: string | null;
}

interface ChatMessageRecord {
  id: number;
  game_id: string;
  sender_user_id: string;
  message: string;
  message_type: "GLOBAL" | "ALLIANCE" | "DIRECT";
  alliance_id: string | null;
  recipient_user_id: string | null;
  created_at: string;
}

interface CommandReplayEntry {
  sourceEventId: number;
  round: number;
  executionIndex: number;
  playerUserId: string;
  commandType: string;
  commandPayload: Record<string, unknown>;
  actionType: string | null;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  createdAt: string;
}

type BoardInteractionMode = "inspect" | "plan";
type MobileSidebarPanel = "lobby" | "players" | "alliances" | "chat" | "invite" | "commands" | "events" | "replay";

type PlannedOrder = {
  orderNumber: number;
  fromHexId: number;
  toHexId: number;
  actionType: OrderActionType;
  troopCount?: number;
};

type ProjectedHexState = {
  ownerUserId: string | null;
  troopCount: number;
  knightCount: number;
};

function shortId(value: string): string {
  const maxLength = 12;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatPayloadInline(payload: Record<string, unknown>): string {
  const raw = JSON.stringify(payload);
  if (raw.length <= 120) return raw;
  return `${raw.slice(0, 117)}...`;
}

function parsePlannedOrder(payload: Record<string, unknown>): PlannedOrder | null {
  const orderNumber = asNumber(payload.orderNumber);
  const fromHexId = asNumber(payload.fromHexId);
  const toHexId = asNumber(payload.toHexId);
  const actionTypeRaw = asText(payload.actionType) ?? "move";
  const actionType: OrderActionType =
    actionTypeRaw === "move" || actionTypeRaw === "attack" || actionTypeRaw === "fortify" || actionTypeRaw === "promote"
      ? actionTypeRaw
      : "move";
  const troopCount = asNumber(payload.troopCount);

  if (orderNumber === null || fromHexId === null || toHexId === null) return null;
  if (!Number.isInteger(orderNumber) || !Number.isInteger(fromHexId) || !Number.isInteger(toHexId)) {
    return null;
  }
  if (orderNumber < 1 || orderNumber > 3) return null;

  const normalizedTroopCount =
    actionType === "move" || actionType === "attack"
      ? Number.isInteger(troopCount) && (troopCount ?? 0) > 0
        ? troopCount
        : null
      : undefined;

  if ((actionType === "move" || actionType === "attack") && normalizedTroopCount === null) return null;

  return {
    orderNumber,
    fromHexId,
    toHexId,
    actionType,
    troopCount: normalizedTroopCount ?? undefined,
  };
}

function cloneProjectedState(input: Map<number, ProjectedHexState>): Map<number, ProjectedHexState> {
  const next = new Map<number, ProjectedHexState>();
  for (const [hexId, value] of input.entries()) {
    next.set(hexId, { ...value });
  }
  return next;
}

function buildPlayerColorMap(input: {
  userIds: string[];
  allianceByUserId: Map<string, string | null>;
  allianceById: Map<string, AllianceRecord>;
}): Record<string, string> {
  const { userIds, allianceByUserId, allianceById } = input;
  const uniqueSorted = [...new Set(userIds)].sort();
  const map: Record<string, string> = {};

  const toHex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  const hslToHex = (h: number, s: number, l: number) => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));

    let r = 0;
    let g = 0;
    let b = 0;

    if (hp >= 0 && hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }

    const m = l - c / 2;
    return `#${toHex(Math.round((r + m) * 255))}${toHex(Math.round((g + m) * 255))}${toHex(Math.round((b + m) * 255))}`;
  };

  const usedColors = new Set<string>();
  const generateUniqueColor = (seedIndex: number): string => {
    let attempts = 0;
    while (attempts < 360) {
      const hue = ((seedIndex + attempts) * 137.508) % 360;
      const candidate = hslToHex(hue, 0.72, 0.52);
      if (!usedColors.has(candidate)) {
        usedColors.add(candidate);
        return candidate;
      }
      attempts += 1;
    }
    const fallback = "#94A3B8";
    usedColors.add(fallback);
    return fallback;
  };

  const allianceIds = [...new Set(uniqueSorted.map((userId) => allianceByUserId.get(userId)).filter((id): id is string => Boolean(id)))].sort();

  allianceIds.forEach((allianceId, index) => {
    const alliance = allianceById.get(allianceId);
    const desired = alliance?.color_hex?.toUpperCase() ?? null;
    const allianceColor = desired && !usedColors.has(desired) ? desired : generateUniqueColor(index);
    usedColors.add(allianceColor);

    uniqueSorted
      .filter((userId) => allianceByUserId.get(userId) === allianceId)
      .forEach((userId) => {
        map[userId] = allianceColor;
      });
  });

  uniqueSorted.forEach((userId, index) => {
    if (map[userId]) return;
    map[userId] = generateUniqueColor(index + allianceIds.length + 1);
  });

  return map;
}

function ensureProjectedHex(state: Map<number, ProjectedHexState>, hexId: number): ProjectedHexState {
  const existing = state.get(hexId);
  if (existing) return existing;

  const created: ProjectedHexState = {
    ownerUserId: null,
    troopCount: 0,
    knightCount: 0,
  };
  state.set(hexId, created);
  return created;
}

function applyProjectedOrderMove(state: Map<number, ProjectedHexState>, order: PlannedOrder, playerUserId: string | null) {
  if (!playerUserId) return;

  const fromHex = ensureProjectedHex(state, order.fromHexId);
  const toHex = ensureProjectedHex(state, order.toHexId);

  if (fromHex.ownerUserId !== playerUserId) return;

  if (order.actionType === "fortify") {
    fromHex.troopCount += 200;
    return;
  }

  if (order.actionType === "promote") {
    if (fromHex.troopCount >= 100) {
      fromHex.troopCount -= 100;
      fromHex.knightCount += 1;
    }
    return;
  }

  if (fromHex.troopCount <= 0) return;
  const requested = order.troopCount ?? 0;
  if (requested <= 0) return;

  const movedTroops = Math.max(0, Math.min(requested, fromHex.troopCount));
  if (movedTroops <= 0) return;

  fromHex.troopCount -= movedTroops;

  if (order.actionType === "attack") {
    const defendingTroops = Math.max(0, toHex.troopCount);
    if (movedTroops > defendingTroops) {
      toHex.ownerUserId = playerUserId;
      toHex.troopCount = movedTroops - defendingTroops;
    } else {
      toHex.troopCount = defendingTroops - movedTroops;
      if (toHex.troopCount === 0 && toHex.ownerUserId !== playerUserId) {
        toHex.ownerUserId = null;
      }
    }
    return;
  }

  toHex.ownerUserId = playerUserId;
  toHex.troopCount += movedTroops;
}

function getCommandReplayEntries(events: GameEventRecord[]): CommandReplayEntry[] {
  return events
    .filter((event) => event.event_type === "command.executed")
    .map((event) => {
      const round = asNumber(event.payload.round);
      const executionIndex = asNumber(event.payload.executionIndex);
      const sourceEventId = asNumber(event.payload.sourceEventId);
      const playerUserId = asText(event.payload.playerUserId);
      const commandType = asText(event.payload.commandType);
      const commandPayload = asRecord(event.payload.payload) ?? {};
      const actionType = asText(event.payload.actionType);
      const stateBefore = asRecord(event.payload.stateBefore);
      const stateAfter = asRecord(event.payload.stateAfter);

      if (
        round === null ||
        executionIndex === null ||
        sourceEventId === null ||
        !playerUserId ||
        !commandType
      ) {
        return null;
      }

      return {
        sourceEventId,
        round,
        executionIndex,
        playerUserId,
        commandType,
        commandPayload,
        actionType,
        stateBefore,
        stateAfter,
        createdAt: event.created_at,
      };
    })
    .filter((entry): entry is CommandReplayEntry => entry !== null);
}

export function GamePage() {
  const { gameId } = useParams({ from: "/games/$gameId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storedActiveGame = getStoredActiveGame();
  const initialGameCode = storedActiveGame?.gameId === gameId ? storedActiveGame.gameCode : undefined;
  const initialSource = storedActiveGame?.gameId === gameId ? storedActiveGame.source : "joined";

  const [activeGameCode, setActiveGameCode] = useState<string | undefined>(initialGameCode);
  const [activeGameSource] = useState<ActiveGame["source"]>(initialSource);

  const activeGame: ActiveGame = {
    gameId,
    gameCode: activeGameCode,
    source: activeGameSource,
  };
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState<CreateInviteResponse | null>(null);
  const [commandType, setCommandType] = useState("order.submit");
  const [commandPayloadText, setCommandPayloadText] = useState('{"orderNumber":1,"actionType":"move","troopCount":1}');
  const [lastCommandAck, setLastCommandAck] = useState<ApplyCommandResponse | null>(null);
  const [gameEvents, setGameEvents] = useState<GameEventRecord[]>([]);
  const [gameEventsError, setGameEventsError] = useState<string | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [newAllianceName, setNewAllianceName] = useState("");
  const [newAllianceColor, setNewAllianceColor] = useState("#22C55E");
  const [chatMessageText, setChatMessageText] = useState("");
  const [chatMessageType, setChatMessageType] = useState<"GLOBAL" | "ALLIANCE" | "DIRECT">("GLOBAL");
  const [chatRecipientUserId, setChatRecipientUserId] = useState<string>("");
  const [selectedHexId, setSelectedHexId] = useState<number>(LEGACY_BOARD.castleId);
  const [plannedFromHexId, setPlannedFromHexId] = useState<number | null>(null);
  const [plannedToHexId, setPlannedToHexId] = useState<number | null>(null);
  const [boardInteractionMode, setBoardInteractionMode] = useState<BoardInteractionMode>("inspect");
  const [activeOrderNumber, setActiveOrderNumber] = useState(1);
  const [activeActionType, setActiveActionType] = useState<OrderActionType>("move");
  const [activeTroopCount, setActiveTroopCount] = useState(1);
  const [isCutscenePlaying, setIsCutscenePlaying] = useState(false);
  const [cutsceneStepIndex, setCutsceneStepIndex] = useState(0);
  const [mobileSidebarPanel, setMobileSidebarPanel] = useState<MobileSidebarPanel>("lobby");

  const authQuery = useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
    },
  });

  const gameDetailsQuery = useQuery({
    queryKey: ["game", "details", activeGame.gameId],
    enabled: Boolean(activeGame.gameId && authQuery.data),
    refetchInterval: authQuery.data ? 5000 : false,
    queryFn: async (): Promise<{
      game: GameDetailsRecord;
      memberships: GameMembershipRecord[];
      readiness: PlayerReadinessRecord[];
      profiles: ProfileRecord[];
      alliances: AllianceRecord[];
      playerAlliances: PlayerAllianceRecord[];
    }> => {
      const [{ data: game, error: gameError }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase
          .schema("secret_toaster")
          .from("games")
          .select("id, game_code, title, status, round, current_state, created_at")
          .eq("id", activeGame.gameId)
          .single(),
        supabase
          .schema("secret_toaster")
          .from("game_memberships")
          .select("id, user_id, role, is_active, joined_at")
          .eq("game_id", activeGame.gameId)
          .order("joined_at", { ascending: true }),
      ]);

      if (gameError || !game) {
        throw new Error(gameError?.message ?? "Failed to load game metadata");
      }

      if (membershipsError || !memberships) {
        throw new Error(membershipsError?.message ?? "Failed to load game memberships");
      }

      const { data: readiness, error: readinessError } = await supabase
        .schema("secret_toaster")
        .from("player_readiness")
        .select("id, user_id, round, is_ready, updated_at")
        .eq("game_id", activeGame.gameId)
        .eq("round", game.round)
        .order("updated_at", { ascending: false });

      if (readinessError || !readiness) {
        throw new Error(readinessError?.message ?? "Failed to load readiness state");
      }

      const memberUserIds = [...new Set(memberships.map((member) => member.user_id))];
      const { data: profiles, error: profilesError } = await supabase
        .schema("core")
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", memberUserIds);

      if (profilesError || !profiles) {
        throw new Error(profilesError?.message ?? "Failed to load player profiles");
      }

      const [{ data: alliances, error: alliancesError }, { data: playerAlliances, error: playerAlliancesError }] =
        await Promise.all([
          supabase
            .schema("secret_toaster")
            .from("game_alliances")
            .select("id, game_id, name, color_hex, created_by, created_at")
            .eq("game_id", activeGame.gameId)
            .order("created_at", { ascending: true }),
          supabase
            .schema("secret_toaster")
            .from("game_player_alliances")
            .select("game_id, user_id, alliance_id")
            .eq("game_id", activeGame.gameId),
        ]);

      if (alliancesError || !alliances) {
        throw new Error(alliancesError?.message ?? "Failed to load alliances");
      }

      if (playerAlliancesError || !playerAlliances) {
        throw new Error(playerAlliancesError?.message ?? "Failed to load alliance memberships");
      }

      return {
        game: game as GameDetailsRecord,
        memberships: memberships as GameMembershipRecord[],
        readiness: readiness as PlayerReadinessRecord[],
        profiles: profiles as ProfileRecord[],
        alliances: alliances as AllianceRecord[],
        playerAlliances: playerAlliances as PlayerAllianceRecord[],
      };
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (): Promise<CreateInviteResponse> => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-create-invite", {
        body: {
          gameId: activeGame.gameId,
          invitedEmail: inviteEmail.trim() || undefined,
          expiresInHours: 72,
        },
      });

      if (error) throw error;

      const payload = data as CreateInviteResponse | null;
      if (!payload || !payload.ok || !payload.inviteToken) {
        throw new Error("Create invite failed");
      }

      return payload;
    },
    onSuccess: (payload) => {
      setGeneratedInvite(payload);
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const userId = authQuery.data?.id;
      if (!userId) throw new Error("Not signed in");

      const displayName = displayNameInput.trim();
      const { error } = await supabase.schema("core").from("profiles").upsert(
        {
          user_id: userId,
          display_name: displayName.length > 0 ? displayName : null,
        },
        { onConflict: "user_id" },
      );

      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
    },
  });

  const createAllianceMutation = useMutation({
    mutationFn: async () => {
      const name = newAllianceName.trim();
      if (name.length < 2) throw new Error("Alliance name must be at least 2 chars");

      const { data, error } = await supabase.functions.invoke("secret-toaster-create-alliance", {
        body: {
          gameId: activeGame.gameId,
          name,
          colorHex: newAllianceColor,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setNewAllianceName("");
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
    },
  });

  const setAllianceMutation = useMutation({
    mutationFn: async (allianceId: string | null) => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-set-alliance", {
        body: {
          gameId: activeGame.gameId,
          allianceId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
    },
  });

  const chatMessagesQuery = useQuery({
    queryKey: ["game", "chat", activeGame.gameId],
    enabled: Boolean(activeGame.gameId && authQuery.data),
    refetchInterval: authQuery.data ? 3000 : false,
    queryFn: async (): Promise<ChatMessageRecord[]> => {
      const { data, error } = await supabase
        .schema("secret_toaster")
        .from("chat_messages")
        .select("id, game_id, sender_user_id, message, message_type, alliance_id, recipient_user_id, created_at")
        .eq("game_id", activeGame.gameId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error || !data) throw new Error(error?.message ?? "Failed to load chat messages");
      return data as ChatMessageRecord[];
    },
  });

  const sendChatMutation = useMutation({
    mutationFn: async () => {
      const message = chatMessageText.trim();
      if (!message) throw new Error("Message is required");

      const { data, error } = await supabase.functions.invoke("secret-toaster-send-chat", {
        body: {
          gameId: activeGame.gameId,
          message,
          messageType: chatMessageType,
          recipientUserId: chatMessageType === "DIRECT" ? chatRecipientUserId || null : null,
          allianceId: chatMessageType === "ALLIANCE" ? currentUserAllianceId ?? null : null,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setChatMessageText("");
      void queryClient.invalidateQueries({ queryKey: ["game", "chat", activeGame.gameId] });
    },
  });

  const setReadyMutation = useMutation({
    mutationFn: async (isReady: boolean) => {
      const { data, error } = await supabase.functions.invoke("secret-toaster-set-ready", {
        body: {
          gameId: activeGame.gameId,
          isReady,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
      void queryClient.invalidateQueries({ queryKey: ["game", "events", activeGame.gameId] });
    },
  });

  const applyCommandMutation = useMutation({
    mutationFn: async (): Promise<ApplyCommandResponse> => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(commandPayloadText) as Record<string, unknown>;
      } catch {
        throw new Error("Command payload must be valid JSON");
      }

      const trimmedCommandType = commandType.trim();
      if (!trimmedCommandType) throw new Error("Command type is required");

      const payloadValidation = validateCommandPayload(trimmedCommandType, payload);
      if (!payloadValidation.success) {
        throw new Error(`Invalid ${trimmedCommandType} payload: ${payloadValidation.error.issues[0]?.message ?? "invalid payload"}`);
      }

      const { data, error } = await supabase.functions.invoke("secret-toaster-apply-command", {
        body: {
          gameId: activeGame.gameId,
          commandType: trimmedCommandType,
          payload: payloadValidation.data,
        },
      });

      if (error) throw error;

      const response = data as ApplyCommandResponse | null;
      if (!response || !response.ok || !response.accepted) {
        throw new Error("Command was not accepted");
      }

      return response;
    },
    onSuccess: (response) => {
      setLastCommandAck(response);
    },
  });

  useEffect(() => {
    setStoredActiveGame({
      gameId,
      gameCode: activeGameCode,
      source: activeGameSource,
    });
  }, [activeGameCode, activeGameSource, gameId]);

  useEffect(() => {
    if (!activeGame.gameId || !authQuery.data) return;

    void (async () => {
      const { data, error } = await supabase
        .schema("secret_toaster")
        .from("games")
        .select("game_code")
        .eq("id", activeGame.gameId)
        .maybeSingle();

      if (!error && data?.game_code) {
        setActiveGameCode((previous) => (previous === data.game_code ? previous : data.game_code));
      }

      const { data: events, error: eventsError } = await supabase
        .schema("secret_toaster")
        .from("game_events")
        .select("id, event_type, payload, caused_by, created_at")
        .eq("game_id", activeGame.gameId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (!eventsError && events) {
        setGameEvents(events as GameEventRecord[]);
        setGameEventsError(null);
      } else if (eventsError) {
        setGameEventsError(eventsError.message);
      }
    })();

    const eventChannel = supabase
      .channel(`game-events-${activeGame.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "secret_toaster",
          table: "game_events",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        (payload) => {
          const next = payload.new as GameEventRecord;
          setGameEvents((previous) => [next, ...previous].slice(0, 200));
        },
      )
      .subscribe();

    const lobbyChannel = supabase
      .channel(`game-lobby-${activeGame.gameId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "games",
          filter: `id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "game_memberships",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "player_readiness",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "chat_messages",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "chat", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "game_alliances",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "secret_toaster",
          table: "game_player_alliances",
          filter: `game_id=eq.${activeGame.gameId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["game", "details", activeGame.gameId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(eventChannel);
      void supabase.removeChannel(lobbyChannel);
    };
  }, [activeGame.gameId, authQuery.data, queryClient]);

  const currentUserReadiness = gameDetailsQuery.data?.readiness.find(
    (entry) => entry.user_id === authQuery.data?.id,
  );
  const readyMemberIds = new Set(
    gameDetailsQuery.data?.readiness.filter((entry) => entry.is_ready).map((entry) => entry.user_id) ?? [],
  );
  const activeMembersCount = gameDetailsQuery.data?.memberships.filter((member) => member.is_active).length ?? 0;
  const readyCount = readyMemberIds.size;
  const allReady = activeMembersCount > 0 && readyCount >= activeMembersCount;

  const inviteLink = generatedInvite
    ? `${window.location.origin}/?inviteToken=${encodeURIComponent(generatedInvite.inviteToken)}`
    : "";

  const commandReplayEntries = getCommandReplayEntries(gameEvents);
  const replayRounds = [...new Set(commandReplayEntries.map((entry) => entry.round))].sort((left, right) => right - left);
  const latestExecutedRound = replayRounds[0] ?? null;
  const latestRoundReplay =
    latestExecutedRound === null
      ? []
      : commandReplayEntries
          .filter((entry) => entry.round === latestExecutedRound)
          .sort((left, right) => left.executionIndex - right.executionIndex);
  const cutsceneSteps = latestRoundReplay
    .map((entry) => {
      const fromHexId = asNumber(entry.commandPayload.fromHexId);
      const toHexId = asNumber(entry.commandPayload.toHexId);
      const actionType = entry.actionType ?? asText(entry.commandPayload.actionType) ?? "move";
      const troopCount = asNumber(entry.commandPayload.troopCount);
      if (fromHexId === null || toHexId === null) return null;

      const label =
        actionType === "move" || actionType === "attack"
          ? `${actionType} ${fromHexId} -> ${toHexId} (${troopCount ?? 0})`
          : `${actionType} ${fromHexId}`;

      return {
        fromHexId,
        toHexId,
        playerUserId: entry.playerUserId,
        label,
        stateAfter: entry.stateAfter,
      };
    })
    .filter(
      (step): step is { fromHexId: number; toHexId: number; playerUserId: string; label: string; stateAfter: Record<string, unknown> | null } =>
        step !== null,
    );
  const activeCutsceneStep = isCutscenePlaying && cutsceneSteps.length > 0 ? cutsceneSteps[cutsceneStepIndex] ?? null : null;
  const activeCutsceneState = activeCutsceneStep?.stateAfter ?? null;
  const currentState = gameDetailsQuery.data?.game.current_state ?? {};
  const currentUserId = authQuery.data?.id ?? null;
  const currentRound = gameDetailsQuery.data?.game.round ?? 0;
  const profileByUserId = new Map((gameDetailsQuery.data?.profiles ?? []).map((profile) => [profile.user_id, profile]));
  const currentUserProfile = currentUserId ? profileByUserId.get(currentUserId) ?? null : null;
  const alliances = gameDetailsQuery.data?.alliances ?? [];
  const playerAlliances = gameDetailsQuery.data?.playerAlliances ?? [];
  const playerAllianceByUserId = new Map(playerAlliances.map((membership) => [membership.user_id, membership.alliance_id]));
  const allianceById = new Map(alliances.map((alliance) => [alliance.id, alliance]));
  const currentUserAllianceId = currentUserId ? playerAllianceByUserId.get(currentUserId) ?? null : null;
  const availableDirectRecipients = (gameDetailsQuery.data?.memberships ?? []).filter((member) => member.user_id !== currentUserId);
  const playerColors = buildPlayerColorMap({
    userIds: (gameDetailsQuery.data?.memberships ?? []).map((member) => member.user_id),
    allianceByUserId: playerAllianceByUserId,
    allianceById,
  });

  const getDisplayName = (userId: string) => {
    const profile = profileByUserId.get(userId);
    const displayName = profile?.display_name?.trim();
    if (displayName) return displayName;
    return shortId(userId);
  };

  useEffect(() => {
    const nextValue = currentUserProfile?.display_name ?? "";
    setDisplayNameInput((current) => (current === nextValue ? current : nextValue));
  }, [currentUserProfile?.display_name]);

  const issuedOrdersByNumber = useMemo(() => {
    const orders = new Map<number, PlannedOrder>();
    if (!currentUserId) return orders;

    const relevantEvents = [...gameEvents]
      .filter((event) => event.event_type === "command.received")
      .sort((left, right) => left.id - right.id);

    for (const event of relevantEvents) {
      const eventRound = asNumber(event.payload.round);
      const eventPlayer = event.caused_by ?? null;
      const eventCommandType = asText(event.payload.commandType);
      const nestedPayload = asRecord(event.payload.payload);
      const order = nestedPayload ? parsePlannedOrder(nestedPayload) : null;

      if (eventRound !== currentRound) continue;
      if (eventPlayer !== currentUserId) continue;
      if (eventCommandType !== "order.submit") continue;
      if (!order) continue;

      orders.set(order.orderNumber, order);
      for (let next = order.orderNumber + 1; next <= 3; next += 1) {
        orders.delete(next);
      }
    }

    return orders;
  }, [currentRound, currentUserId, gameEvents]);

  const projectedStateBeforeActiveOrder = useMemo(() => {
    const projected = new Map<number, ProjectedHexState>();

    for (const hex of LEGACY_BOARD.hexes) {
      const snapshot = getHexSnapshot(currentState, hex.index);
      if (!snapshot) continue;
      projected.set(hex.index, {
        ownerUserId: snapshot.ownerUserId,
        troopCount: snapshot.troopCount ?? 0,
        knightCount: snapshot.knightCount ?? 0,
      });
    }

    for (let orderNumber = 1; orderNumber < activeOrderNumber; orderNumber += 1) {
      const issued = issuedOrdersByNumber.get(orderNumber);
      if (!issued) continue;
      applyProjectedOrderMove(projected, issued, currentUserId);
    }

    return projected;
  }, [activeOrderNumber, currentState, currentUserId, issuedOrdersByNumber]);

  const projectedHexSnapshot = (hexId: number): ProjectedHexState | null => {
    const projected = projectedStateBeforeActiveOrder.get(hexId);
    if (projected) return projected;
    const snapshot = getHexSnapshot(currentState, hexId);
    if (!snapshot) return null;
    return {
      ownerUserId: snapshot.ownerUserId,
      troopCount: snapshot.troopCount ?? 0,
      knightCount: snapshot.knightCount ?? 0,
    };
  };

  const selectedHex = LEGACY_BOARD.hexes[selectedHexId] ?? null;
  const selectedHexSnapshot = selectedHex ? getHexSnapshot(currentState, selectedHex.index) : null;
  const selectedProjectedSnapshot = selectedHex ? projectedHexSnapshot(selectedHex.index) : null;
  const selectedHexNeighbors =
    selectedHex?.neighbors.filter((neighbor): neighbor is number => neighbor !== null) ?? [];

  const projectedStartFromPreviousOrder = activeOrderNumber > 1 ? (issuedOrdersByNumber.get(activeOrderNumber - 1)?.toHexId ?? null) : null;

  const legalStartHexIds =
    projectedStartFromPreviousOrder !== null
      ? [projectedStartFromPreviousOrder]
      : LEGACY_BOARD.hexes
          .filter((hex) => hex.type !== "BLANK")
          .map((hex) => {
            const snapshot = projectedHexSnapshot(hex.index);
            const ownedByCurrentUser = Boolean(currentUserId && snapshot?.ownerUserId === currentUserId);
            const hasUnits = (snapshot?.troopCount ?? 0) > 0 || (snapshot?.knightCount ?? 0) > 0;
            return ownedByCurrentUser && hasUnits ? hex.index : null;
          })
          .filter((hexId): hexId is number => hexId !== null);

  const legalStartHexIdSet = new Set<number>(legalStartHexIds);
  const selfTargetAction = activeActionType === "fortify" || activeActionType === "promote";
  const legalDestinationHexIds =
    plannedFromHexId === null
      ? []
      : selfTargetAction
        ? [plannedFromHexId]
      : (LEGACY_BOARD.hexes[plannedFromHexId]?.neighbors
          .filter((neighbor): neighbor is number => {
            if (neighbor === null) return false;
            const neighborHex = LEGACY_BOARD.hexes[neighbor];
            return Boolean(neighborHex && neighborHex.type !== "BLANK");
          }) ?? []);
  const legalDestinationHexIdSet = new Set<number>(legalDestinationHexIds);
  const selectedIsReachableFromPlannedStart = legalDestinationHexIdSet.has(selectedHexId);
  const plannedFromSnapshot = plannedFromHexId === null ? null : projectedHexSnapshot(plannedFromHexId);
  const maxTroopsForPlannedStart = Math.max(1, plannedFromSnapshot?.troopCount ?? 1);

  const projectedAfterActiveOrder = useMemo(() => {
    const next = cloneProjectedState(projectedStateBeforeActiveOrder);
    if (plannedFromHexId === null || plannedToHexId === null) return next;

    applyProjectedOrderMove(
      next,
      {
        orderNumber: activeOrderNumber,
        fromHexId: plannedFromHexId,
        toHexId: plannedToHexId,
        actionType: activeActionType,
        troopCount: activeTroopCount,
      },
      currentUserId,
    );

    return next;
  }, [activeOrderNumber, activeTroopCount, currentUserId, plannedFromHexId, plannedToHexId, projectedStateBeforeActiveOrder]);

  const selectedProjectedAfterActiveOrder = selectedHex ? projectedAfterActiveOrder.get(selectedHex.index) ?? null : null;
  const canSubmitPlannedOrder = plannedFromHexId !== null && plannedToHexId !== null;
  const orderedQueuedOrders = [1, 2, 3]
    .map((slot) => issuedOrdersByNumber.get(slot) ?? null)
    .filter((order): order is PlannedOrder => order !== null);

  const updateCommandPayloadOrderFields = (
    fromHexId: number | null,
    toHexId: number | null,
    troopCount: number,
    actionType: OrderActionType,
  ) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(commandPayloadText) as Record<string, unknown>;
    } catch {
      parsed = {};
    }

    const nextPayload: Record<string, unknown> = { ...parsed };
    if (fromHexId === null) {
      delete nextPayload.fromHexId;
    } else {
      nextPayload.fromHexId = fromHexId;
    }

    if (toHexId === null) {
      delete nextPayload.toHexId;
    } else {
      nextPayload.toHexId = toHexId;
    }

    nextPayload.actionType = actionType;
    if (actionType === "move" || actionType === "attack") {
      nextPayload.troopCount = Math.max(1, Math.floor(troopCount));
    } else {
      delete nextPayload.troopCount;
    }

    nextPayload.orderNumber = activeOrderNumber;

    setCommandPayloadText(JSON.stringify(nextPayload, null, 2));
  };

  const setSelectedAsOrderStart = () => {
    if (!legalStartHexIdSet.has(selectedHexId)) return;
    const nextStart = selectedHexId;
    setPlannedFromHexId(nextStart);

    if (selfTargetAction) {
      setPlannedToHexId(nextStart);
      updateCommandPayloadOrderFields(nextStart, nextStart, activeTroopCount, activeActionType);
      setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
      return;
    }

    setPlannedToHexId((currentTo) => {
      const isCurrentStillReachable =
        currentTo === null ? true : LEGACY_BOARD.hexes[nextStart]?.neighbors.some((neighbor) => neighbor === currentTo) ?? false;
      const nextTo = isCurrentStillReachable ? currentTo : null;
      updateCommandPayloadOrderFields(nextStart, nextTo, activeTroopCount, activeActionType);
      return nextTo;
    });
    setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
  };

  const setSelectedAsOrderDestination = () => {
    if (plannedFromHexId === null) return;

     if (selfTargetAction) {
      setPlannedToHexId(plannedFromHexId);
      updateCommandPayloadOrderFields(plannedFromHexId, plannedFromHexId, activeTroopCount, activeActionType);
      return;
    }

    const isReachable = legalDestinationHexIdSet.has(selectedHexId);
    if (!isReachable) return;

    setPlannedToHexId(selectedHexId);
    updateCommandPayloadOrderFields(plannedFromHexId, selectedHexId, activeTroopCount, activeActionType);
    setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
  };

  const clearPlannedOrder = () => {
    setPlannedFromHexId(null);
    setPlannedToHexId(null);
    updateCommandPayloadOrderFields(null, null, activeTroopCount, activeActionType);
  };

  useEffect(() => {
    const issued = issuedOrdersByNumber.get(activeOrderNumber);
    if (issued) {
      setPlannedFromHexId(issued.fromHexId);
      setPlannedToHexId(issued.toHexId);
      setActiveTroopCount(issued.troopCount ?? 1);
      setActiveActionType(issued.actionType);
      updateCommandPayloadOrderFields(issued.fromHexId, issued.toHexId, issued.troopCount ?? activeTroopCount, issued.actionType);
      return;
    }

    if (projectedStartFromPreviousOrder !== null) {
      setPlannedFromHexId(projectedStartFromPreviousOrder);
      setPlannedToHexId(null);
      updateCommandPayloadOrderFields(projectedStartFromPreviousOrder, null, activeTroopCount, activeActionType);
      return;
    }

    setPlannedFromHexId(null);
    setPlannedToHexId(null);
    updateCommandPayloadOrderFields(null, null, activeTroopCount, activeActionType);
  }, [activeOrderNumber, issuedOrdersByNumber, projectedStartFromPreviousOrder]);

  useEffect(() => {
    updateCommandPayloadOrderFields(plannedFromHexId, plannedToHexId, activeTroopCount, activeActionType);
  }, [activeTroopCount, activeActionType]);

  useEffect(() => {
    setActiveTroopCount((current) => Math.max(1, Math.min(current, maxTroopsForPlannedStart)));
  }, [maxTroopsForPlannedStart]);

  useEffect(() => {
    if (plannedFromHexId === null) return;
    if (selfTargetAction) {
      setPlannedToHexId(plannedFromHexId);
      updateCommandPayloadOrderFields(plannedFromHexId, plannedFromHexId, activeTroopCount, activeActionType);
      return;
    }

    if (plannedToHexId === plannedFromHexId) {
      setPlannedToHexId(null);
      updateCommandPayloadOrderFields(plannedFromHexId, null, activeTroopCount, activeActionType);
    }
  }, [activeActionType, plannedFromHexId]);

  useEffect(() => {
    if (!isCutscenePlaying) return;
    if (cutsceneSteps.length === 0) {
      setIsCutscenePlaying(false);
      return;
    }

    if (cutsceneStepIndex >= cutsceneSteps.length) {
      setIsCutscenePlaying(false);
      setCutsceneStepIndex(0);
      return;
    }

    const timeout = window.setTimeout(() => {
      setCutsceneStepIndex((current) => current + 1);
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [isCutscenePlaying, cutsceneStepIndex, cutsceneSteps.length]);

  const handleBoardHexSelect = (hexId: number) => {
    if (isCutscenePlaying) return;
    setSelectedHexId(hexId);

    if (boardInteractionMode !== "plan") return;

    if (plannedFromHexId === null) {
      if (!legalStartHexIdSet.has(hexId)) return;
      setPlannedFromHexId(hexId);
      if (selfTargetAction) {
        setPlannedToHexId(hexId);
        updateCommandPayloadOrderFields(hexId, hexId, activeTroopCount, activeActionType);
      } else {
        setPlannedToHexId(null);
        updateCommandPayloadOrderFields(hexId, null, activeTroopCount, activeActionType);
      }
      setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
      return;
    }

    if (hexId === plannedFromHexId) {
      clearPlannedOrder();
      return;
    }

    if (legalDestinationHexIdSet.has(hexId)) {
      setPlannedToHexId(hexId);
      updateCommandPayloadOrderFields(plannedFromHexId, hexId, activeTroopCount, activeActionType);
      setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
      return;
    }

    if (legalStartHexIdSet.has(hexId)) {
      setPlannedFromHexId(hexId);
      if (selfTargetAction) {
        setPlannedToHexId(hexId);
        updateCommandPayloadOrderFields(hexId, hexId, activeTroopCount, activeActionType);
      } else {
        setPlannedToHexId(null);
        updateCommandPayloadOrderFields(hexId, null, activeTroopCount, activeActionType);
      }
      setCommandType((current) => (current === "order.submit" ? current : "order.submit"));
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
  };

  const mobilePanelClass = (panel: MobileSidebarPanel) =>
    mobileSidebarPanel === panel ? "block" : "hidden";

  const savePlannedOrder = async (advanceToNextSlot: boolean) => {
    if (!canSubmitPlannedOrder || applyCommandMutation.isPending) return;

    const response = await applyCommandMutation.mutateAsync();
    if (advanceToNextSlot && response.accepted && activeOrderNumber < 3) {
      setActiveOrderNumber((current) => Math.min(3, current + 1));
    }
  };

  if (!authQuery.data && !authQuery.isLoading) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>Go back to the homepage and sign in first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-svh w-full space-y-3 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Game Workspace</h1>
          <p className="text-muted-foreground">Game {activeGame.gameCode ?? shortId(activeGame.gameId)}</p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <Button variant="secondary" asChild>
            <Link to="/">Back to Home</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setStoredActiveGame(null);
              void navigate({ to: "/" });
            }}
          >
            Leave Workspace
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 lg:hidden">
        {(
          [
            ["lobby", "Lobby"],
            ["players", "Players"],
            ["alliances", "Alliances"],
            ["chat", "Chat"],
            ["invite", "Invite"],
            ["commands", "Commands"],
            ["events", "Events"],
            ["replay", "Replay"],
          ] as Array<[MobileSidebarPanel, string]>
        ).map(([panel, label]) => (
          <Button
            key={panel}
            type="button"
            size="xs"
            variant={mobileSidebarPanel === panel ? "default" : "outline"}
            onClick={() => setMobileSidebarPanel(panel)}
          >
            {label}
          </Button>
        ))}
      </div>

      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">

      <Card className={`${mobilePanelClass("lobby")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Lobby</CardTitle>
          <CardDescription>Metadata, members, and readiness for the active round.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {gameDetailsQuery.isLoading ? <p>Loading game details...</p> : null}
          {gameDetailsQuery.isError ? <p>Lobby load error: {gameDetailsQuery.error.message}</p> : null}
          {gameDetailsQuery.data ? (
            <>
              <p>
                Status: <strong>{gameDetailsQuery.data.game.status}</strong>
              </p>
              <p>
                Round: <strong>{gameDetailsQuery.data.game.round}</strong>
              </p>
              <p>
                Created: {new Date(gameDetailsQuery.data.game.created_at).toLocaleString()}
              </p>
              <p>
                Ready: <strong>{readyCount}</strong> / {activeMembersCount}
                {allReady ? " (all ready)" : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={currentUserReadiness?.is_ready ? "secondary" : "default"}
                  disabled={setReadyMutation.isPending}
                  onClick={() => setReadyMutation.mutate(!(currentUserReadiness?.is_ready ?? false))}
                >
                  {setReadyMutation.isPending
                    ? "Updating..."
                    : currentUserReadiness?.is_ready
                      ? "Set Not Ready"
                      : "Set Ready"}
                </Button>
              </div>
              {setReadyMutation.isError ? <p>Ready error: {setReadyMutation.error.message}</p> : null}
              <ul>
                {gameDetailsQuery.data.memberships.map((member) => (
                  <li key={member.id}>
                    <span
                      className="mr-1 inline-block size-2 rounded-full"
                      style={{ backgroundColor: playerColors[member.user_id] ?? "#94A3B8" }}
                    />
                    {getDisplayName(member.user_id)}
                    {member.user_id === authQuery.data?.id ? " (you)" : ""} - {member.role}
                    {member.is_active ? "" : " (inactive)"}
                    {readyMemberIds.has(member.user_id) ? " - ready" : " - not ready"}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("players")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Players</CardTitle>
          <CardDescription>Manage your profile and view current players in this game.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfileMutation.mutate();
            }}
          >
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayNameInput}
                onChange={(event) => setDisplayNameInput(event.target.value)}
                placeholder="Commander Toast"
                maxLength={40}
              />
            </div>
            <Button type="submit" disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? "Saving..." : "Save display name"}
            </Button>
          </form>
          {updateProfileMutation.isError ? <p>Profile error: {updateProfileMutation.error.message}</p> : null}

          {gameDetailsQuery.data ? (
            <ul className="space-y-1 text-sm">
              {gameDetailsQuery.data.memberships.map((member) => (
                <li key={member.id} className="rounded border px-2 py-1">
                  <span
                    className="mr-1 inline-block size-2 rounded-full"
                    style={{ backgroundColor: playerColors[member.user_id] ?? "#94A3B8" }}
                  />
                  <strong>{getDisplayName(member.user_id)}</strong>
                  {member.user_id === currentUserId ? " (you)" : ""}
                  <span className="text-muted-foreground">
                    {" "}- {member.role}
                    {playerAllianceByUserId.get(member.user_id)
                      ? `, ${allianceById.get(playerAllianceByUserId.get(member.user_id) ?? "")?.name ?? "Alliance"}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("alliances")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Alliances</CardTitle>
          <CardDescription>Create and join alliances for scoped chat and coordination.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createAllianceMutation.mutate();
            }}
          >
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="alliance-name">New alliance name</Label>
              <Input
                id="alliance-name"
                value={newAllianceName}
                onChange={(event) => setNewAllianceName(event.target.value)}
                placeholder="The Toasters"
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="alliance-color">Color</Label>
              <Input
                id="alliance-color"
                type="color"
                value={newAllianceColor}
                onChange={(event) => setNewAllianceColor(event.target.value.toUpperCase())}
                className="h-9 w-16"
              />
            </div>
            <Button type="submit" disabled={createAllianceMutation.isPending}>
              {createAllianceMutation.isPending ? "Creating..." : "Create alliance"}
            </Button>
          </form>
          {createAllianceMutation.isError ? <p>Alliance error: {createAllianceMutation.error.message}</p> : null}

          {alliances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alliances yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {alliances.map((alliance) => {
                const memberCount = playerAlliances.filter((entry) => entry.alliance_id === alliance.id).length;
                const inAlliance = currentUserAllianceId === alliance.id;
                return (
                  <li key={alliance.id} className="flex items-center justify-between rounded border p-2">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ backgroundColor: alliance.color_hex ?? "#94A3B8" }} />
                      <span>
                        <strong>{alliance.name}</strong> ({memberCount})
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant={inAlliance ? "secondary" : "outline"}
                      disabled={setAllianceMutation.isPending}
                      onClick={() => setAllianceMutation.mutate(inAlliance ? null : alliance.id)}
                    >
                      {inAlliance ? "Leave" : "Join"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("chat")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
          <CardDescription>Global, alliance, and direct messages for in-game communication.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendChatMutation.mutate();
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="chat-type">Channel</Label>
                <select
                  id="chat-type"
                  value={chatMessageType}
                  onChange={(event) => setChatMessageType(event.target.value as "GLOBAL" | "ALLIANCE" | "DIRECT")}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="GLOBAL">GLOBAL</option>
                  <option value="ALLIANCE" disabled={!currentUserAllianceId}>
                    ALLIANCE
                  </option>
                  <option value="DIRECT">DIRECT</option>
                </select>
              </div>

              {chatMessageType === "DIRECT" ? (
                <div className="space-y-1">
                  <Label htmlFor="chat-recipient">Recipient</Label>
                  <select
                    id="chat-recipient"
                    value={chatRecipientUserId}
                    onChange={(event) => setChatRecipientUserId(event.target.value)}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">Select player</option>
                    {availableDirectRecipients.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {getDisplayName(member.user_id)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <Textarea
              value={chatMessageText}
              onChange={(event) => setChatMessageText(event.target.value)}
              rows={3}
              placeholder="Type your message..."
            />
            <Button type="submit" disabled={sendChatMutation.isPending}>
              {sendChatMutation.isPending ? "Sending..." : "Send message"}
            </Button>
          </form>
          {sendChatMutation.isError ? <p>Chat error: {sendChatMutation.error.message}</p> : null}

          {chatMessagesQuery.isError ? <p>Chat load error: {chatMessagesQuery.error.message}</p> : null}
          {chatMessagesQuery.data && chatMessagesQuery.data.length > 0 ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded border p-2 text-sm">
              {chatMessagesQuery.data.map((message) => {
                const channelLabel =
                  message.message_type === "ALLIANCE"
                    ? `ALLIANCE:${allianceById.get(message.alliance_id ?? "")?.name ?? "unknown"}`
                    : message.message_type === "DIRECT"
                      ? `DIRECT:${message.recipient_user_id ? getDisplayName(message.recipient_user_id) : "unknown"}`
                      : "GLOBAL";

                return (
                  <li key={message.id} className="rounded border px-2 py-1">
                    <span className="text-xs text-muted-foreground">[{channelLabel}]</span>{" "}
                    <strong>{getDisplayName(message.sender_user_id)}:</strong> {message.message}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No chat messages yet.</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-start-1 lg:row-start-1 lg:row-span-8 lg:sticky lg:top-3">
        <CardHeader>
          <CardTitle>Game Board</CardTitle>
          <CardDescription className="text-foreground/75">
            Legacy board layout with keeps, castle, and current-state overlays.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="boardLand">Land</Badge>
            <Badge variant="boardKeep">Keep</Badge>
            <Badge variant="boardCastle">Castle</Badge>
            <Badge variant="boardBlank">Blank</Badge>
            <Badge variant="boardStateActive">Hover</Badge>
            <Badge variant="boardStateNeighbor">Reachable</Badge>
            <Badge variant="boardStateSelected">Selected</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant={boardInteractionMode === "inspect" ? "default" : "outline"}
              disabled={isCutscenePlaying}
              onClick={() => setBoardInteractionMode("inspect")}
            >
              Inspect mode
            </Button>
            <Button
              type="button"
              size="xs"
              variant={boardInteractionMode === "plan" ? "default" : "outline"}
              disabled={isCutscenePlaying}
              onClick={() => setBoardInteractionMode("plan")}
            >
              Plan mode
            </Button>
            <span className="text-xs text-muted-foreground">
              {boardInteractionMode === "plan"
                ? "Click your owned hex with units, then click a reachable destination"
                : "Select any hex to inspect details"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Order slot:</span>
            {[1, 2, 3].map((slot) => (
              <Button
                key={slot}
                type="button"
                size="xs"
                variant={activeOrderNumber === slot ? "default" : "outline"}
                onClick={() => setActiveOrderNumber(slot)}
              >
                {slot}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              {activeOrderNumber > 1 && projectedStartFromPreviousOrder !== null
                ? `Projected start from order ${activeOrderNumber - 1}: #${projectedStartFromPreviousOrder}`
                : "Order 1 starts from your currently owned hexes with units"}
            </span>
            <div className="flex items-center gap-2">
              <Label htmlFor="order-action-type" className="text-xs text-muted-foreground">
                Action
              </Label>
              <select
                id="order-action-type"
                value={activeActionType}
                onChange={(event) => setActiveActionType(event.target.value as OrderActionType)}
                className="h-7 rounded-md border bg-background px-2 text-xs"
              >
                <option value="move">move</option>
                <option value="attack">attack</option>
                <option value="fortify">fortify</option>
                <option value="promote">promote</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="order-troop-count" className="text-xs text-muted-foreground">
                Troops
              </Label>
              <Input
                id="order-troop-count"
                type="number"
                min={1}
                max={maxTroopsForPlannedStart}
                value={activeTroopCount}
                disabled={activeActionType === "fortify" || activeActionType === "promote"}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setActiveTroopCount(Math.max(1, Math.min(Math.floor(next), maxTroopsForPlannedStart)));
                }}
                className="h-7 w-24"
              />
            </div>
            <Button
              type="button"
              size="xs"
              disabled={isCutscenePlaying || !canSubmitPlannedOrder || applyCommandMutation.isPending}
              onClick={() => {
                void savePlannedOrder(false);
              }}
            >
              {applyCommandMutation.isPending ? "Saving..." : "Save order"}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={isCutscenePlaying || !canSubmitPlannedOrder || applyCommandMutation.isPending || activeOrderNumber >= 3}
              onClick={() => {
                void savePlannedOrder(true);
              }}
            >
              Save + next order
            </Button>
          </div>

          <div className="rounded-md border bg-card p-3 text-xs">
            <p className="font-medium">Queued orders this round</p>
            {orderedQueuedOrders.length === 0 ? (
              <p className="text-muted-foreground">No orders saved yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {orderedQueuedOrders.map((order) => (
                  <li key={order.orderNumber} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                    <span>
                      #{order.orderNumber} {order.actionType} {order.fromHexId} -&gt; {order.toHexId}
                      {order.troopCount ? ` (${order.troopCount} troops)` : ""}
                    </span>
                    <Button size="xs" variant="outline" onClick={() => setActiveOrderNumber(order.orderNumber)}>
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <GameBoardCanvas
            currentState={currentState}
            playbackState={activeCutsceneState}
            selectedHexId={selectedHexId}
            plannedFromHexId={plannedFromHexId}
            plannedToHexId={plannedToHexId}
            legalDestinationHexIds={plannedFromHexId === null ? undefined : legalDestinationHexIds}
            playerColors={playerColors}
            playbackStep={activeCutsceneStep}
            onSelectHex={isCutscenePlaying ? () => {} : handleBoardHexSelect}
          />

          {selectedHex ? (
            <div className="rounded-md border bg-card p-3 text-sm">
              <p>
                Selected hex <strong>#{selectedHex.index}</strong> ({legacyBoardX(selectedHex.index)},{" "}
                {legacyBoardY(selectedHex.index)}) - {selectedHex.type}
              </p>
              <p>
                Troops: <strong>{selectedHexSnapshot?.troopCount ?? 0}</strong> | Knights:{" "}
                <strong>{selectedHexSnapshot?.knightCount ?? 0}</strong>
              </p>
              <p>
                Owner: <strong>{selectedHexSnapshot?.ownerUserId ? shortId(selectedHexSnapshot.ownerUserId) : "none"}</strong>
              </p>
              <p className="text-muted-foreground">
                Projected before order {activeOrderNumber}: troops <strong>{selectedProjectedSnapshot?.troopCount ?? 0}</strong>, owner{" "}
                <strong>{selectedProjectedSnapshot?.ownerUserId ? shortId(selectedProjectedSnapshot.ownerUserId) : "none"}</strong>
              </p>
              <p className="text-muted-foreground">
                Projected after order {activeOrderNumber}: troops <strong>{selectedProjectedAfterActiveOrder?.troopCount ?? 0}</strong>, owner{" "}
                <strong>
                  {selectedProjectedAfterActiveOrder?.ownerUserId ? shortId(selectedProjectedAfterActiveOrder.ownerUserId) : "none"}
                </strong>
              </p>
              <p>
                Neighbors:{" "}
                <strong>
                  {selectedHexNeighbors.join(", ") || "none"}
                </strong>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={!legalStartHexIdSet.has(selectedHexId)}
                  onClick={setSelectedAsOrderStart}
                >
                  Set as start
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={plannedFromHexId === null || (!selfTargetAction && !selectedIsReachableFromPlannedStart)}
                  onClick={setSelectedAsOrderDestination}
                >
                  {selfTargetAction ? "Use same hex" : "Set as destination"}
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={clearPlannedOrder}>
                  Clear planned order
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                Planned order {activeOrderNumber}: {activeActionType} from {plannedFromHexId ?? "-"} to {plannedToHexId ?? "-"}
                {activeActionType === "move" || activeActionType === "attack" ? ` with ${activeTroopCount} troops` : ""}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("invite")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Invite Link</CardTitle>
          <CardDescription>Create and share tokenized invite links.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              createInviteMutation.mutate();
            }}
          >
            <Label htmlFor="invite-email">Invite email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="friend@example.com"
            />
            <Button type="submit" disabled={createInviteMutation.isPending}>
              {createInviteMutation.isPending ? "Creating invite..." : "Create invite token"}
            </Button>
          </form>

          {createInviteMutation.isError ? <p>Invite error: {createInviteMutation.error.message}</p> : null}

          {generatedInvite ? (
            <>
              <p>
                Invite token: <code>{generatedInvite.inviteToken}</code>
              </p>
              <p>Expires: {new Date(generatedInvite.expiresAt).toLocaleString()}</p>
              <p>
                Invite link: <code>{inviteLink}</code>
              </p>
              <Button type="button" variant="secondary" onClick={() => void copyInviteLink()}>
                Copy invite link
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("commands")} lg:col-start-2 lg:block`}>
        <CardHeader>
          <CardTitle>Command Submit</CardTitle>
          <CardDescription>Send command payloads to the authoritative apply-command endpoint.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyCommandMutation.mutate();
            }}
          >
            <Label htmlFor="command-type">Command type</Label>
            <Input
              id="command-type"
              type="text"
              value={commandType}
              onChange={(event) => setCommandType(event.target.value)}
              placeholder="order.submit"
            />
            <Label htmlFor="command-payload">Payload (JSON)</Label>
            <Textarea
              id="command-payload"
              value={commandPayloadText}
              onChange={(event) => setCommandPayloadText(event.target.value)}
              rows={4}
            />
            <Button type="submit" disabled={applyCommandMutation.isPending}>
              {applyCommandMutation.isPending ? "Submitting..." : "Submit command"}
            </Button>
          </form>
          {applyCommandMutation.isError ? <p>Command error: {applyCommandMutation.error.message}</p> : null}
          {lastCommandAck ? (
            <p>
              Last command accepted at {new Date(lastCommandAck.createdAt).toLocaleTimeString()} (event #
              {lastCommandAck.eventId})
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("events")} lg:col-start-1 lg:block`}>
        <CardHeader>
          <CardTitle>Game Events</CardTitle>
          <CardDescription>Live feed of game events for this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {gameEventsError ? <p>Event load error: {gameEventsError}</p> : null}
          {gameEvents.length === 0 ? (
            <p>No realtime events yet.</p>
          ) : (
            <ul>
              {gameEvents.map((event) => (
                <li key={event.id}>
                  {event.event_type} at {new Date(event.created_at).toLocaleTimeString()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className={`${mobilePanelClass("replay")} lg:col-start-1 lg:block`}>
        <CardHeader>
          <CardTitle>Round Replay Helper</CardTitle>
          <CardDescription>
            Deterministic command execution order for the most recently executed round.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {latestExecutedRound === null ? <p>No executed rounds yet.</p> : null}
          {latestExecutedRound !== null ? (
            <>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  disabled={cutsceneSteps.length === 0}
                  onClick={() => {
                    setCutsceneStepIndex(0);
                    setIsCutscenePlaying(true);
                  }}
                >
                  Play round cutscene
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!isCutscenePlaying}
                  onClick={() => setIsCutscenePlaying(false)}
                >
                  Pause
                </Button>
                <span className="text-xs text-muted-foreground">
                  {isCutscenePlaying
                    ? `Step ${Math.min(cutsceneStepIndex + 1, cutsceneSteps.length)} / ${cutsceneSteps.length}`
                    : "Playback paused"}
                </span>
              </div>

              <p>
                Latest executed round: <strong>{latestExecutedRound}</strong>
              </p>
              <p>
                Recent executed rounds: <strong>{replayRounds.join(", ")}</strong>
              </p>
              {latestRoundReplay.length === 0 ? (
                <p>No command execution entries found for this round.</p>
              ) : (
                <ol>
                  {latestRoundReplay.map((entry) => (
                    <li key={entry.sourceEventId}>
                      #{entry.executionIndex + 1} - {entry.commandType} by {shortId(entry.playerUserId)} at{" "}
                      {new Date(entry.createdAt).toLocaleTimeString()} (source event #{entry.sourceEventId}) - payload:{" "}
                      <code>{formatPayloadInline(entry.commandPayload)}</code>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
      </section>
    </main>
  );
}
