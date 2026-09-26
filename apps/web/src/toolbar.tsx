import { LevelChip } from "./level-chip";
import { PALETTE, PENCIL_SIZES } from "./stroke";
import type { SurfaceView, Tool } from "./surface";
import { CONNECTION_LABEL, type Connection } from "./sync";

const DOT_PX = { Small: 4, Medium: 9, Large: 16 } as const;

export type HistoryState = { canUndo: boolean; canRedo: boolean };

type ToolbarProps = {
  tool: Tool;
  onChange: (tool: Tool) => void;
  connection: Connection;
  history: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  view: SurfaceView;
  onLevel: (level: number) => void;
  shareOpen: boolean;
  onShare: () => void;
};

export function Toolbar({
  tool,
  onChange,
  connection,
  history,
  onUndo,
  onRedo,
  view,
  onLevel,
  shareOpen,
  onShare,
}: ToolbarProps) {
  return (
    <div class="toolbar" role="toolbar" aria-label="Drawing tools">
      <fieldset class="group" aria-label="Pencil size">
        {PENCIL_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={tool.mode === "Pencil" && tool.size === size}
            aria-label={`${size} pencil`}
            class="tool"
            onClick={() => onChange({ ...tool, size, mode: "Pencil" })}
          >
            <span class="dot" style={{ width: DOT_PX[size], height: DOT_PX[size] }} />
          </button>
        ))}
      </fieldset>
      <fieldset class="group" aria-label="Colour">
        {PALETTE.map((colour, index) => (
          <button
            key={colour}
            type="button"
            aria-pressed={tool.primary === index}
            aria-label={`Colour ${index + 1}`}
            title="Tap for primary, right-click or long-press for secondary"
            class={tool.secondary === index ? "tool swatch secondary" : "tool swatch"}
            style={{ background: colour }}
            onClick={() => onChange({ ...tool, primary: index })}
            onContextMenu={(event) => {
              event.preventDefault();
              onChange({ ...tool, secondary: index });
            }}
          />
        ))}
      </fieldset>
      <button
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Pan"}
        aria-label="Pan tool"
        title="Drag with one finger to move the board"
        onClick={() => onChange({ ...tool, mode: tool.mode === "Pan" ? "Pencil" : "Pan" })}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Select"}
        aria-label="Select tool"
        title="Tap a stroke to select it, drag to move it, Delete to remove it"
        onClick={() => onChange({ ...tool, mode: tool.mode === "Select" ? "Pencil" : "Select" })}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M5 3l14 8-6 2-3 6-5-16z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Eraser"}
        aria-label="Eraser"
        title="Tap or drag across a stroke to delete it"
        onClick={() => onChange({ ...tool, mode: tool.mode === "Eraser" ? "Pencil" : "Eraser" })}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M16 3l5 5-11 11H5l-3-3L16 3zM9 10l5 5M10 21h11"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="tool pair"
        aria-label="Swap primary and secondary colour"
        onClick={() => onChange({ ...tool, primary: tool.secondary, secondary: tool.primary })}
      >
        <span class="chip back" style={{ background: PALETTE[tool.secondary] }} />
        <span class="chip front" style={{ background: PALETTE[tool.primary] }} />
      </button>
      <fieldset class="group" aria-label="History">
        <button
          type="button"
          class="tool"
          aria-label="Undo"
          title="Undo your last change (Ctrl+Z)"
          disabled={!history.canUndo}
          onClick={onUndo}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="tool"
          aria-label="Redo"
          title="Redo your last undone change (Ctrl+Shift+Z)"
          disabled={!history.canRedo}
          onClick={onRedo}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </fieldset>
      <button
        type="button"
        class="tool"
        data-share-toggle
        aria-pressed={shareOpen}
        aria-label="Share"
        title="Share the board link, QR code and PIN"
        onClick={onShare}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4M18 5a2.5 2.5 0 11-.01 0M6 9.5a2.5 2.5 0 11-.01 0M18 16.5a2.5 2.5 0 11-.01 0"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <LevelChip level={view.level} contentLevels={view.contentLevels} onPick={onLevel} />
      <span
        class="status"
        data-connection={connection}
        role="status"
        aria-label={CONNECTION_LABEL[connection]}
        title={CONNECTION_LABEL[connection]}
      />
    </div>
  );
}
