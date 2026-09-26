import { openBoard } from "@stallion/client-sync";
import { useEffect, useRef, useState } from "preact/hooks";
import { errorMessage, reportLink } from "./report";
import { createSurface, type Surface, type SurfaceView, type Tool, type ToolMode } from "./surface";
import { type BoardSource, type Connection, openSource, syncUrlFor } from "./sync";
import { type HistoryState, Toolbar } from "./toolbar";

const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false };

const INITIAL_VIEW: SurfaceView = { level: 0, contentLevels: [] };

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
    size: "Medium",
    primary: 0,
    secondary: 4,
    mode: "Pencil",
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>("LocalOnly");
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [view, setView] = useState<SurfaceView>(INITIAL_VIEW);
  const sourceRef = useRef<BoardSource | undefined>(undefined);
  const surfaceRef = useRef<Surface | undefined>(undefined);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
      const action = historyKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "Undo") source.history.undo();
      else source.history.redo();
    };
    window.addEventListener("keydown", onKey);
    let surface: Surface | undefined;
    try {
      surface = createSurface(canvas, boardId, source, () => toolRef.current, setView);
      surfaceRef.current = surface;
    } catch (failure) {
      setError(`Could not start the drawing surface: ${errorMessage(failure)}`);
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      unobserve();
      sourceRef.current = undefined;
      setHistory(EMPTY_HISTORY);
      surfaceRef.current = undefined;
      surface?.dispose();
      source
        .close()
        .catch((failure: unknown) =>
          setError(`Could not close the board: ${errorMessage(failure)}`),
        );
    };
  }, [boardId]);

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
      />
      {error && (
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
