export type RoomStatus = 'waiting' | 'paired' | 'in_progress' | 'finished' | 'expired';

export type PlayerRole = 'display' | 'controller';

export interface RoomMetadata {
  roomCode: string;
  status: RoomStatus;
  createdAt: number;
  displaySocketId?: string;
  controllerSocketId?: string;
}

export enum GameItemType {
  FRUIT = 'FRUIT',
  BOMB = 'BOMB',
}

export interface ScoreUpdate {
  score: number;
  combo: number;
  lives: number;
}
