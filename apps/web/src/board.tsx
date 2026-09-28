import { openBoard } from "@stallion/client-sync";
import { PALETTE_RGB, PENCIL_PX } from "@stallion/schema";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { boardPath } from "./board-path";
import { myBoardsForPage, thumbnailUploader } from "./my-boards";
import { PinPrompt } from "./pin-prompt";
import type { Presence } from "./presence";
import { loadRecents, renameRecent, saveRecents, upsertRecent } from "./recents";
import { useConnectionNotice } from "./reconnect";
import { ReconnectNotice } from "./reconnect-notice";
import { errorMessage, reportLink } from "./report";
import { boardLink, SharePanel } from "./share";
import { createSurface, type Surface, type SurfaceView, type Tool, type ToolMode } from "./surface";
import { type BoardSource, type Connection, openSource, syncUrlFor } from "./sync";
import { captureThumbnail } from "./thumbnail";
import { type HistoryState, Toolbar } from "./toolbar";
import { loadStyle } from "./toolbar-layout";

const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false };

const INITIAL_VIEW: SurfaceView = { level: 0, contentLevels: [] };

const THUMBNAIL_DELAY_MS = 2000;

const NO_PRESENCE: Presence = { peers: [], following: undefined };

const storedName = (boardId: string): string =>
  loadRecents(localStorage).find((recent) => recent.id === boardId)?.name ?? boardId;

const clearRenamed = (boardId: string, renamedAt: number): void => {
  const recents = loadRecents(localStorage).map((recent) =>
    recent.id === boardId && recent.renamedAt === renamedAt ? { ...recent, renamedAt: 0 } : recent,
  );
  saveRecents(localStorage, recents);
};

const historyKey = (event: KeyboardEvent): "Undo" | "Redo" | undefined => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "Redo" : "Undo";
  if (key === "y" && !event.shiftKey) return "Redo";
  return undefined;
};

const SURFACE_CLASS: Record<ToolMode, string> = {
  Pencil: "surface",
  Pan: "surface panning",
  Eraser: "surface erasing",
  Select: "surface selecting",
};

export function Board({ boardId }: { boardId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>({
    width: PENCIL_PX.Medium,
    style: loadStyle(() => localStorage),
    primary: PALETTE_RGB[0],
    secondary: PALETTE_RGB[4],
    mode: "Pencil",
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>("LocalOnly");
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [view, setView] = useState<SurfaceView>(INITIAL_VIEW);
  const [shareOpen, setShareOpen] = useState(false);
  const [presence, setPresence] = useState<Presence>(NO_PRESENCE);
  const [name, setName] = useState(() => storedName(boardId));
  const sourceRef = useRef<BoardSource | undefined>(undefined);
  const surfaceRef = useRef<Surface | undefined>(undefined);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const closeShare = useCallback(() => setShareOpen(false), []);
  const checkAuthExpired = useCallback(async () => {
    const result = await myBoardsForPage()?.list();
    return (
      result !== undefined &&
      !result.ok &&
      (result.reason === "AuthRedirect" ||
        result.reason === "Http401" ||
        result.reason === "Http403")
    );
  }, []);
  const notice = useConnectionNotice(connection, checkAuthExpired);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const openedAt = Date.now();
    saveRecents(
      localStorage,
      upsertRecent(loadRecents(localStorage), { id: boardId, lastOpened: openedAt }),
    );
    const api = myBoardsForPage();
    let live = true;
    void api?.upsert(boardId, { lastOpened: openedAt }).then((result) => {
      if (!live || !result.ok) return;
      const local = loadRecents(localStorage).find((recent) => recent.id === boardId);
      if (local?.renamedAt !== 0 || local.name === result.value.name) return;
      saveRecents(
        localStorage,
        upsertRecent(loadRecents(localStorage), {
          id: boardId,
          name: result.value.name,
          lastOpened: local.lastOpened,
        }),
      );
      setName(result.value.name);
    });
    const uploads = thumbnailUploader((thumbnail) => {
      void api?.upsert(boardId, { thumbnail });
    });
    const source = openSource({
      url: syncUrlFor(import.meta.env.VITE_SYNC_URL, window.location),
      boardId,
      openBoard,
      onConnection: setConnection,
      onError: setError,
    });
    sourceRef.current = source;
    const syncHistory = () =>
      setHistory({ canUndo: source.history.canUndo, canRedo: source.history.canRedo });
    const unobserve = source.history.observe(syncHistory);
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const action = historyKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "Undo") source.history.undo();
      else source.history.redo();
    };
    window.addEventListener("keydown", onKey);
    let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
    const saveThumbnail = () => {
      thumbnailTimer = undefined;
      const thumbnail = captureThumbnail(canvas);
      if (!thumbnail) return;
      saveRecents(
        localStorage,
        upsertRecent(loadRecents(localStorage), { id: boardId, thumbnail }),
      );
      uploads.push(thumbnail);
    };
    const scheduleThumbnail = () => {
      clearTimeout(thumbnailTimer);
      thumbnailTimer = setTimeout(saveThumbnail, THUMBNAIL_DELAY_MS);
    };
    let surface: Surface | undefined;
    try {
      surface = createSurface(
        canvas,
        boardId,
        source,
        () => toolRef.current,
        setView,
        scheduleThumbnail,
        setPresence,
      );
      surfaceRef.current = surface;
    } catch (failure) {
      setError(`Could not start the drawing surface: ${errorMessage(failure)}`);
    }
    return () => {
      live = false;
      if (thumbnailTimer !== undefined) {
        clearTimeout(thumbnailTimer);
        saveThumbnail();
      }
      uploads.flush();
      window.removeEventListener("keydown", onKey);
      unobserve();
      sourceRef.current = undefined;
      setHistory(EMPTY_HISTORY);
      setPresence(NO_PRESENCE);
      surfaceRef.current = undefined;
      surface?.dispose();
      source
        .close()
        .catch((failure: unknown) =>
          setError(`Could not close the board: ${errorMessage(failure)}`),
        );
    };
  }, [boardId]);

  useEffect(() => {
    const path = boardPath(boardId, name);
    if (window.location.pathname === path) return;
    const { search, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${path}${search}${hash}`);
  }, [boardId, name]);

  const rename = useCallback(
    (next: string) => {
      const renamedAt = Date.now();
      saveRecents(localStorage, renameRecent(loadRecents(localStorage), boardId, next, renamedAt));
      setName(next);
      myBoardsForPage()
        ?.upsert(boardId, { name: next })
        .then((result) => {
          if (!result.ok) {
            setError(`Could not save the board name: ${result.message}`);
            return;
          }
          clearRenamed(boardId, renamedAt);
        });
    },
    [boardId],
  );

  return (
    <main class="board">
      <canvas
        ref={canvasRef}
        class={SURFACE_CLASS[tool.mode]}
        aria-label={`Drawing board ${boardId}`}
      />
      <Toolbar
        tool={tool}
        onChange={setTool}
        connection={connection}
        history={history}
        onUndo={() => sourceRef.current?.history.undo()}
        onRedo={() => sourceRef.current?.history.redo()}
        view={view}
        onLevel={(level) => surfaceRef.current?.zoomToLevel(level)}
        shareOpen={shareOpen}
        onShare={() => setShareOpen(!shareOpen)}
        presence={presence}
        onFollow={(clientId) => surfaceRef.current?.follow(clientId)}
      />
      <ReconnectNotice
        notice={notice}
        reconnectMessage="Can't reach the board. Your strokes are kept and sent when it reconnects."
      />
      {shareOpen && (
        <SharePanel
          link={boardLink(window.location.origin, boardId, name)}
          name={name}
          onRename={rename}
          source={sourceRef.current}
          onClose={closeShare}
        />
      )}
      {connection === "Locked" && (
        <PinPrompt
          lock={sourceRef.current?.lock}
          onJoin={(pin) =>
            sourceRef.current
              ? sourceRef.current.join(pin)
              : Promise.resolve({ ok: false, reason: "Closed", message: "the board is not open" })
          }
        />
      )}
      {error && notice === "None" && (
        <div class="error" role="alert">
          <p>{error}. Strokes may not be saved; reload to try again.</p>
          <a href={reportLink(error)} target="_blank" rel="noreferrer">
            Report an issue
          </a>
        </div>
      )}
    </main>
  );
}
