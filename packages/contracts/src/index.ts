import { z } from "zod";

export const LEGACY_HEX_ID_MAX = 109;
export const OrderActionTypeSchema = z.enum(["move", "attack", "fortify", "promote"]);

export const JoinGameByInviteSchema = z.object({
  inviteToken: z.string().min(1),
});

export const ApplyCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const OrderSubmitPayloadBaseSchema = z.object({
  orderNumber: z.number().int().min(1).max(3),
  fromHexId: z.number().int().min(0).max(LEGACY_HEX_ID_MAX),
  toHexId: z.number().int().min(0).max(LEGACY_HEX_ID_MAX),
});

const OrderMovePayloadSchema = OrderSubmitPayloadBaseSchema.extend({
  actionType: z.literal("move"),
  troopCount: z.number().int().min(1),
}).strict();

const OrderAttackPayloadSchema = OrderSubmitPayloadBaseSchema.extend({
  actionType: z.literal("attack"),
  troopCount: z.number().int().min(1),
}).strict();

const OrderFortifyPayloadSchema = OrderSubmitPayloadBaseSchema.extend({
  actionType: z.literal("fortify"),
})
  .strict()
  .refine((payload) => payload.fromHexId === payload.toHexId, {
    message: "Fortify requires fromHexId and toHexId to match",
    path: ["toHexId"],
  });

const OrderPromotePayloadSchema = OrderSubmitPayloadBaseSchema.extend({
  actionType: z.literal("promote"),
})
  .strict()
  .refine((payload) => payload.fromHexId === payload.toHexId, {
    message: "Promote requires fromHexId and toHexId to match",
    path: ["toHexId"],
  });

export const OrderSubmitPayloadSchema = z.union([
  OrderMovePayloadSchema,
  OrderAttackPayloadSchema,
  OrderFortifyPayloadSchema,
  OrderPromotePayloadSchema,
]);

export function validateCommandPayload(commandType: string, payload: unknown) {
  if (commandType === "order.submit") {
    const parsedPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? ({ actionType: "move", ...(payload as Record<string, unknown>) } as Record<string, unknown>)
        : payload;

    return OrderSubmitPayloadSchema.safeParse(parsedPayload);
  }

  return z.record(z.string(), z.unknown()).safeParse(payload ?? {});
}

export type JoinGameByInviteInput = z.infer<typeof JoinGameByInviteSchema>;
export type ApplyCommandInput = z.infer<typeof ApplyCommandSchema>;
export type OrderSubmitPayload = z.infer<typeof OrderSubmitPayloadSchema>;
export type OrderActionType = z.infer<typeof OrderActionTypeSchema>;
