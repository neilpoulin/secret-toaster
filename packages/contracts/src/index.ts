import { z } from "zod";

export const JoinGameByInviteSchema = z.object({
  inviteToken: z.string().min(1),
});

export const ApplyCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type JoinGameByInviteInput = z.infer<typeof JoinGameByInviteSchema>;
export type ApplyCommandInput = z.infer<typeof ApplyCommandSchema>;
