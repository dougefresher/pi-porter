import { ClientEvent, EventType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk/lib/matrix.js';

export type DirectRoomMap = Record<string, string[]>;

export function directRoomIdsFromMap(map: DirectRoomMap | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!map || typeof map !== 'object') return ids;
  for (const roomIds of Object.values(map)) {
    if (!Array.isArray(roomIds)) continue;
    for (const roomId of roomIds) {
      if (typeof roomId === 'string' && roomId.trim()) ids.add(roomId);
    }
  }
  return ids;
}

export function isDirectRoomWithFallback(
  room: Room,
  directRoomIds: ReadonlySet<string>,
  mDirectSeeded: boolean,
): boolean {
  if (directRoomIds.has(room.roomId)) return true;
  if (mDirectSeeded) return false;
  return room.getJoinedMemberCount() === 2;
}

export class DirectRoomTracker {
  private directRoomIds = new Set<string>();
  private mDirectSeeded = false;
  private client: MatrixClient;

  constructor(client: MatrixClient) {
    this.client = client;
  }

  attach(): void {
    this.refreshFromAccountData();
    this.client.on(ClientEvent.AccountData, (event: MatrixEvent) => {
      if (event.getType() !== EventType.Direct) return;
      this.applyDirectMap(event.getContent() as DirectRoomMap);
    });
  }

  refreshFromAccountData(): void {
    const event = this.client.getAccountData(EventType.Direct);
    if (!event) return;
    this.applyDirectMap(event.getContent() as DirectRoomMap);
  }

  private applyDirectMap(map: DirectRoomMap | null | undefined): void {
    this.mDirectSeeded = true;
    this.directRoomIds = directRoomIdsFromMap(map);
  }

  isDirectRoom(room: Room): boolean {
    return isDirectRoomWithFallback(room, this.directRoomIds, this.mDirectSeeded);
  }
}
