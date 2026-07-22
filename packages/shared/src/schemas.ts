import { z } from 'zod';
import { ROOM_CODE_LENGTH } from './constants';

export const JoinRoomSchema = z.object({
  roomCode: z.string().length(ROOM_CODE_LENGTH),
  role: z.enum(['display', 'controller']),
});

export const MotionStreamSchema = z.object({
  t: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  alpha: z.number(),
  beta: z.number(),
  gamma: z.number(),
  seq: z.number(),
});

export const CreateRoomResponseSchema = z.object({
  roomCode: z.string(),
  roomId: z.string(),
  joinUrl: z.string().url(),
  expiresAt: z.number(),
});
