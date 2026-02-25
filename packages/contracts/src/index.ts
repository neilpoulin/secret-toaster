import { z } from "zod";

export const LEGACY_HEX_ID_MAX = 109;

export const JoinGameByInviteSchema = z.object({
  inviteToken: z.string().min(1),
});

export const ApplyCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const OrderSubmitPayloadSchema = z
  .object({
    orderNumber: z.number().int().min(1).max(3),
    fromHexId: z.number().int().min(0).max(LEGACY_HEX_ID_MAX),
    toHexId: z.number().int().min(0).max(LEGACY_HEX_ID_MAX),
    troopCount: z.number().int().min(1),
  })
  .strict();

export function validateCommandPayload(commandType: string, payload: unknown) {
  if (commandType === "order.submit") {
    return OrderSubmitPayloadSchema.safeParse(payload);
  }

  return z.record(z.string(), z.unknown()).safeParse(payload ?? {});
}

export type JoinGameByInviteInput = z.infer<typeof JoinGameByInviteSchema>;
export type ApplyCommandInput = z.infer<typeof ApplyCommandSchema>;
export type OrderSubmitPayload = z.infer<typeof OrderSubmitPayloadSchema>;
