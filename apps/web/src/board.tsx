import { useEffect, useRef, useState } from "preact/hooks";
import { createSurface, type Tool } from "./surface";
import { Toolbar } from "./toolbar";

const ISSUE_URL = "https://github.com/mvhenten/stallion/issues/new";

const reportLink = (message: string): string =>
  `${ISSUE_URL}?${new URLSearchParams({
    title: "Drawing board error",
    body: `${message}\n\nBrowser: ${navigator.userAgent}`,
  })}`;

export function Board({ boardId }: { boardId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>({
    size: "Medium",
    primary: 0,
    secondary: 4,
    pan: false,
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = createSurface(canvas, boardId, () => toolRef.current, setError);
    return () => surface.dispose();
  }, [boardId]);

  return (
    <main class="board">
      <canvas
        ref={canvasRef}
        class={tool.pan ? "surface panning" : "surface"}
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
