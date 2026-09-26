import type { Camera } from "./camera";

export type Viewport = { x: number; y: number; zoom: number };

export type Peer = { clientId: number; name: string; colour: string; self: boolean };

export type PeerState = Peer & { viewport: Viewport | undefined };

export type Presence = { peers: readonly Peer[]; following: number | undefined };

export const GUEST = "Guest";

export const PRESENCE_THROTTLE_MS = 100;

export const displayName = (identity: unknown): string => {
  if (typeof identity !== "string") return GUEST;
  const trimmed = identity.trim();
  if (trimmed === "") return GUEST;
  const at = trimmed.indexOf("@");
  if (at === -1) return trimmed;
  return at === 0 ? GUEST : trimmed.slice(0, at);
};

export const presenceColour = (clientId: number): string =>
  `hsl(${Math.round((clientId * 137.508) % 360)} 70% 42%)`;

export const viewportOf = (camera: Camera, width: number, height: number): Viewport => ({
  x: camera.x + width / 2 / camera.zoom,
  y: camera.y + height / 2 / camera.zoom,
  zoom: camera.zoom,
});

export const cameraFor = (viewport: Viewport, width: number, height: number): Camera => ({
  x: viewport.x - width / 2 / viewport.zoom,
  y: viewport.y - height / 2 / viewport.zoom,
  zoom: viewport.zoom,
});

const isViewport = (value: unknown): value is Viewport => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, zoom } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof zoom === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(zoom) &&
    zoom > 0
  );
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export const peerOf = (clientId: number, state: unknown, selfId: number): PeerState => {
  const self = clientId === selfId;
  const viewport = field(field(state, "presence"), "viewport");
  return {
    clientId,
    name: self ? "You" : displayName(field(field(state, "user"), "name")),
    colour: presenceColour(clientId),
    self,
    viewport: isViewport(viewport) ? viewport : undefined,
  };
};

export const peersOf = (states: ReadonlyMap<number, unknown>, selfId: number): PeerState[] =>
  [...states]
    .map(([clientId, state]) => peerOf(clientId, state, selfId))
    .sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);

export const samePresence = (a: Presence, b: Presence): boolean =>
  a.following === b.following &&
  a.peers.length === b.peers.length &&
  a.peers.every(
    (peer, index) =>
      peer.clientId === b.peers[index]?.clientId &&
      peer.name === b.peers[index]?.name &&
      peer.self === b.peers[index]?.self,
  );
