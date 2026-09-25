import { useEffect, useRef, useState } from "preact/hooks";
import { errorMessage, reportLink } from "./report";
import { createSurface, type Tool, type ToolMode } from "./surface";
import { Toolbar } from "./toolbar";

const SURFACE_CLASS: Record<ToolMode, string> = {
  Pencil: "surface",
  Pan: "surface panning",
  Eraser: "surface erasing",
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
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const surface = createSurface(canvas, boardId, () => toolRef.current, setError);
      return () => surface.dispose();
    } catch (failure) {
      setError(`Could not start the drawing surface: ${errorMessage(failure)}`);
    }
  }, [boardId]);

  return (
    <main class="board">
      <canvas
        ref={canvasRef}
        class={SURFACE_CLASS[tool.mode]}
        aria-label={`Drawing board ${boardId}`}
      />
      <Toolbar tool={tool} onChange={setTool} />
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
