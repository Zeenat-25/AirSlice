/**
 * Client to Server Events
 */
export const CLIENT_EVENTS = {
  ROOM_JOIN: 'room:join',
  MOTION_STREAM: 'motion:stream',
  CONTROLLER_CALIBRATE: 'controller:calibrate',
  GAME_START: 'game:start',
  GAME_RESTART: 'game:restart',
} as const;

/**
 * Server to Client Events
 */
export const SERVER_EVENTS = {
  ROOM_PAIRED: 'room:paired',
  ROOM_EXPIRED: 'room:expired',
  CONTROLLER_DISCONNECTED: 'room:controller_disconnected',
  CONTROLLER_RECONNECTED: 'room:controller_reconnected',
  SWORD_MOTION: 'sword:motion',
  ERROR: 'error',
} as const;

/**
 * Payload Types
 */
export interface MotionPayload {
  t: number;      // Timestamp
  x: number;      // Accelerometer X
  y: number;      // Accelerometer Y
  z: number;      // Accelerometer Z
  alpha: number;  // Gyro Alpha (Z)
  beta: number;   // Gyro Beta (X)
  gamma: number;  // Gyro Gamma (Y)
  seq: number;    // Sequence number for ordering
}

export interface JoinRoomPayload {
  roomCode: string;
  role: PlayerRole;
}
