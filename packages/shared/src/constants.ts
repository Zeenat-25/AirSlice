/**
 * Room Configuration
 */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0, O, 1, I, l)
export const ROOM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Real-time Configuration
 */
export const MOTION_TICK_RATE = 40; // Hz (25ms interval)
export const MOTION_LOW_PASS_ALPHA = 0.2; // Smoothing factor

/**
 * Game Configuration
 */
export const INITIAL_LIVES = 3;
export const COMBO_WINDOW_MS = 800;
export const MAX_FRUITS_PER_SCREEN = 10;
