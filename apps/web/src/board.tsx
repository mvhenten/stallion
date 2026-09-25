import { openBoard } from "@stallion/client-sync";
import { useEffect, useRef, useState } from "preact/hooks";
import { errorMessage, reportLink } from "./report";
import { createSurface, type Tool, type ToolMode } from "./surface";
import { type Connection, openSource, syncUrlFor } from "./sync";
import { Toolbar } from "./toolbar";

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
    let surface: ReturnType<typeof createSurface> | undefined;
    try {
      surface = createSurface(canvas, boardId, source, () => toolRef.current);
    } catch (failure) {
      setError(`Could not start the drawing surface: ${errorMessage(failure)}`);
    }
    return () => {
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
      <Toolbar tool={tool} onChange={setTool} connection={connection} />
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
