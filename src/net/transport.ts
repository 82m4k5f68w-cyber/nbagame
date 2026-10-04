// Transport abstraction for online play. Every peer publishes ONE latest-state object ("presence");
// receivers always get the newest merged object per peer. Intermediate states may be dropped
// (sender-side coalescing ~30 Hz), so everything sent must be absolute state, never deltas without a baseline.
// Implementations: claude.ai room capability (published artifact), WebSocket relay (self-hosted / Node), in-memory (tests).
export interface Peer {
  id: string;
  me: boolean;
  state: Record<string, any>;
}
export interface Transport {
  readonly kind: string;
  readonly me: string;
  peers(): Peer[];
  /** Called when anyone's presence changes (and on join/leave). */
  onPeers(fn: (peers: Peer[]) => void): () => void;
  /** Merge a patch into MY presence (null removes a field). */
  presence(patch: Record<string, any>): void;
  connected(): boolean;
  leave(): void;
}
export const PROTO = 5;
/** Presence objects must stay under ~4 KiB of JSON (room capability limit). */
export const PRESENCE_MAX = 3900;
