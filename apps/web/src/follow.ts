import type { Camera } from "./camera";
import { easeOut } from "./level";
import { cameraFor, type PeerState, type Viewport, viewportOf } from "./presence";

export const FOLLOW_ANIMATION_MS = 200;

export type FollowDeps = {
  camera(): Camera;
  size(): { width: number; height: number };
  move(camera: Camera): void;
  requestFrame(step: (now: number) => void): number;
  cancelFrame(handle: number): void;
  now(): number;
  onChange(target: number | undefined): void;
};

export type Follow = {
  readonly target: number | undefined;
  start(clientId: number): void;
  stop(): void;
  peers(peers: readonly PeerState[]): void;
  dispose(): void;
};

const sameViewport = (a: Viewport | undefined, b: Viewport | undefined): boolean =>
  a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

export function createFollow(deps: FollowDeps): Follow {
  let target: number | undefined;
  let goal: Viewport | undefined;
  let latest = new Map<number, Viewport | undefined>();
  let frame = 0;

  const cancel = () => {
    if (frame !== 0) deps.cancelFrame(frame);
    frame = 0;
  };

  const animateTo = (viewport: Viewport) => {
    if (sameViewport(goal, viewport)) return;
    goal = viewport;
    cancel();
    const { width, height } = deps.size();
    const from = viewportOf(deps.camera(), width, height);
    const started = deps.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / FOLLOW_ANIMATION_MS);
      const k = easeOut(t);
      const size = deps.size();
      deps.move(
        cameraFor(
          {
            x: from.x + (viewport.x - from.x) * k,
            y: from.y + (viewport.y - from.y) * k,
            zoom: from.zoom * (viewport.zoom / from.zoom) ** k,
          },
          size.width,
          size.height,
        ),
      );
      frame = t < 1 ? deps.requestFrame(step) : 0;
    };
    frame = deps.requestFrame(step);
  };

  const stop = () => {
    cancel();
    goal = undefined;
    if (target === undefined) return;
    target = undefined;
    deps.onChange(undefined);
  };

  return {
    get target() {
      return target;
    },
    start(clientId) {
      if (!latest.has(clientId)) return;
      cancel();
      goal = undefined;
      target = clientId;
      deps.onChange(clientId);
      const viewport = latest.get(clientId);
      if (viewport) animateTo(viewport);
    },
    stop,
    peers(peers) {
      latest = new Map(peers.map((peer) => [peer.clientId, peer.viewport]));
      if (target === undefined) return;
      if (!latest.has(target)) {
        stop();
        return;
      }
      const viewport = latest.get(target);
      if (viewport) animateTo(viewport);
    },
    dispose: cancel,
  };
}
