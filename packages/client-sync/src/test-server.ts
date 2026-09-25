import { type BBox, type LevelRange, type ViewTiles, viewTiles } from "@stallion/geometry";
import { BOARD_KEY, decodeFrame, encodeFrame, type Frame, type FrameKind } from "@stallion/schema";
import { decode as decodeCbor } from "cbor-x";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { messageYjsSyncStep1, writeSyncStep1, writeSyncStep2, writeUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import type { Connect, SocketHandlers } from "./socket";

type Session = {
  handlers: SocketHandlers;
  tiles: Set<string>;
  view: ViewTiles | undefined;
  received: Frame[];
};

const OBJECTS = "objects";

const later = (task: () => void): void => {
  setTimeout(task, 0);
};

const covers = (range: LevelRange, key: string): boolean => {
  const [level, tx, ty] = key.split(":").map(Number);
  return (
    range.level === level &&
    tx !== undefined &&
    ty !== undefined &&
    tx >= range.minTx &&
    tx <= range.maxTx &&
    ty >= range.minTy &&
    ty <= range.maxTy
  );
};

const message = (write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
};

const isViewPayload = (value: unknown): value is BBox & { zoom: number } =>
  typeof value === "object" &&
  value !== null &&
  ["minX", "minY", "maxX", "maxY", "zoom"].every(
    (field) => typeof Reflect.get(value, field) === "number",
  );

export class TestServer {
  readonly docs = new Map<string, Y.Doc>();
  readonly sessions = new Set<Session>();
  online = true;

  readonly connect: Connect = (_url, handlers) => {
    const session: Session = { handlers, tiles: new Set(), view: undefined, received: [] };
    later(() => {
      if (!this.online) {
        handlers.close();
        return;
      }
      this.sessions.add(session);
      handlers.open();
    });
    return {
      send: (data) => later(() => this.sessions.has(session) && this.receive(session, data)),
      close: () => later(() => this.drop(session)),
    };
  };

  goOffline(): void {
    this.online = false;
    for (const session of [...this.sessions]) this.drop(session);
  }

  goOnline(): void {
    this.online = true;
  }

  subscribed(session: Session, key: string): boolean {
    return (
      session.tiles.has(key) || (session.view?.live.some((range) => covers(range, key)) ?? false)
    );
  }

  objectIds(key: string): string[] {
    return [...(this.docs.get(key)?.getMap(OBJECTS).keys() ?? [])].sort();
  }

  private drop(session: Session): void {
    if (!this.sessions.delete(session)) return;
    session.handlers.close();
  }

  private doc(key: string): Y.Doc {
    const existing = this.docs.get(key);
    if (existing) return existing;
    const doc = new Y.Doc();
    this.docs.set(key, doc);
    return doc;
  }

  private sendTo(session: Session, tileKey: string, kind: FrameKind, payload: Uint8Array): void {
    const bytes = encodeFrame({ tileKey, kind, payload: new Uint8Array(payload) });
    later(() => this.sessions.has(session) && session.handlers.message(bytes));
  }

  private receive(session: Session, bytes: Uint8Array): void {
    const decoded = decodeFrame(bytes);
    if (!decoded.ok) throw new Error(decoded.error);
    const frame = decoded.value;
    session.received.push(frame);
    const { tileKey: key, payload } = frame;
    switch (frame.kind) {
      case "Subscribe":
        session.tiles.add(key);
        this.sendTo(
          session,
          key,
          "Sync",
          message((e) => writeSyncStep1(e, this.doc(key))),
        );
        return;
      case "Unsubscribe":
        session.tiles.delete(key);
        return;
      case "Awareness":
        for (const other of this.sessions) {
          if (other !== session) this.sendTo(other, BOARD_KEY, "Awareness", payload);
        }
        return;
      case "View":
        this.view(session, decodeCbor(payload));
        return;
      case "Sync":
        this.sync(session, key, payload);
        return;
      default:
        throw new Error(`clients cannot send ${frame.kind}`);
    }
  }

  private view(session: Session, value: unknown): void {
    if (!isViewPayload(value)) throw new Error("invalid view payload");
    const { zoom, ...bounds } = value;
    const tiles = viewTiles(bounds, zoom);
    const before = new Set([...this.docs.keys()].filter((key) => this.subscribed(session, key)));
    session.view = tiles;
    for (const key of [...session.tiles]) {
      if (!tiles.live.some((range) => covers(range, key))) session.tiles.delete(key);
    }
    for (const [key, doc] of this.docs) {
      if (doc.getMap(OBJECTS).size === 0) continue;
      if (tiles.snapshot.some((range) => covers(range, key))) {
        this.sendTo(session, key, "Snapshot", Y.encodeStateAsUpdate(doc));
        continue;
      }
      if (!tiles.live.some((range) => covers(range, key)) || before.has(key)) continue;
      this.sendTo(
        session,
        key,
        "Sync",
        message((e) => writeSyncStep1(e, doc)),
      );
      this.sendTo(
        session,
        key,
        "Sync",
        message((e) => writeSyncStep2(e, doc)),
      );
    }
  }

  private sync(session: Session, key: string, payload: Uint8Array): void {
    if (!this.subscribed(session, key)) {
      this.sendTo(session, key, "Reject", new TextEncoder().encode("tile is not subscribed"));
      return;
    }
    const doc = this.doc(key);
    const decoder = decoding.createDecoder(payload);
    const type = decoding.readVarUint(decoder);
    const body = decoding.readVarUint8Array(decoder);
    if (type === messageYjsSyncStep1) {
      this.sendTo(
        session,
        key,
        "Sync",
        message((e) => writeSyncStep2(e, doc, body)),
      );
      return;
    }
    Y.applyUpdate(doc, body, session);
    for (const other of this.sessions) {
      if (other !== session && this.subscribed(other, key)) {
        this.sendTo(
          other,
          key,
          "Sync",
          message((e) => writeUpdate(e, body)),
        );
      }
    }
  }
}
