import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LevelChip } from "./level-chip";
import type { Presence } from "./presence";
import { FollowPill, PresenceStrip } from "./presence-strip";
import { PALETTE, PENCIL_SIZES } from "./stroke";
import type { SurfaceView, Tool } from "./surface";
import { CONNECTION_LABEL, type Connection } from "./sync";
import {
  type Control,
  expandedAfterPick,
  loadExpanded,
  saveExpanded,
  toolbarLayout,
  toolbarRows,
  WIDE_QUERY,
} from "./toolbar-layout";

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
  presence: Presence;
  onFollow: (clientId: number | undefined) => void;
};

const storage = () => localStorage;

const matchesWide = (): boolean => window.matchMedia(WIDE_QUERY).matches;

const useWide = (): boolean => {
  const [wide, setWide] = useState(matchesWide);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
};

function Icon({ d, join }: { d: string; join?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin={join ? "round" : undefined}
      />
    </svg>
  );
}

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
  presence,
  onFollow,
}: ToolbarProps) {
  const wide = useWide();
  const [expanded, setExpanded] = useState(() => loadExpanded(storage));
  const layout = toolbarLayout(wide, expanded);

  const expand = (next: boolean) => {
    setExpanded(next);
    saveExpanded(storage, next);
  };
  const pick = (next: Tool) => {
    onChange(next);
    const after = expandedAfterPick(wide, expanded);
    if (after !== expanded) expand(after);
  };
  const toggleMode = (mode: Tool["mode"]) =>
    pick({ ...tool, mode: tool.mode === mode ? "Pencil" : mode });

  const controls: Record<Control, () => JSX.Element> = {
    Sizes: () => (
      <fieldset key="Sizes" class="group" aria-label="Pencil size">
        {PENCIL_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={tool.mode === "Pencil" && tool.size === size}
            aria-label={`${size} pencil`}
            class="tool"
            onClick={() => pick({ ...tool, size, mode: "Pencil" })}
          >
            <span class="dot" style={{ width: DOT_PX[size], height: DOT_PX[size] }} />
          </button>
        ))}
      </fieldset>
    ),
    Colours: () => (
      <fieldset key="Colours" class="group" aria-label="Colour">
        {PALETTE.map((colour, index) => (
          <button
            key={colour}
            type="button"
            aria-pressed={tool.primary === index}
            aria-label={`Colour ${index + 1}`}
            title="Tap for primary, right-click or long-press for secondary"
            class={tool.secondary === index ? "tool swatch secondary" : "tool swatch"}
            onClick={() => pick({ ...tool, primary: index })}
            onContextMenu={(event) => {
              event.preventDefault();
              pick({ ...tool, secondary: index });
            }}
          >
            <span class="swatch-fill" style={{ background: colour }} />
          </button>
        ))}
      </fieldset>
    ),
    CurrentColour: () => (
      <button
        key="CurrentColour"
        type="button"
        class="tool swatch current"
        aria-label={`Colour ${tool.primary + 1}, show colours`}
        title="Show sizes and colours"
        onClick={() => expand(!expanded)}
      >
        <span class="swatch-fill" style={{ background: PALETTE[tool.primary] }} />
      </button>
    ),
    Pencil: () => (
      <button
        key="Pencil"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Pencil"}
        aria-label={`${tool.size} pencil`}
        title="Draw"
        onClick={() => pick({ ...tool, mode: "Pencil" })}
      >
        <Icon d="M4 20l1-5L16 4l4 4L9 19l-5 1zM14 6l4 4" join />
      </button>
    ),
    Pan: () => (
      <button
        key="Pan"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Pan"}
        aria-label="Pan tool"
        title="Drag with one finger to move the board"
        onClick={() => toggleMode("Pan")}
      >
        <Icon d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
      </button>
    ),
    Select: () => (
      <button
        key="Select"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Select"}
        aria-label="Select tool"
        title="Tap a stroke to select it, drag to move it, Delete to remove it"
        onClick={() => toggleMode("Select")}
      >
        <Icon d="M5 3l14 8-6 2-3 6-5-16z" join />
      </button>
    ),
    Eraser: () => (
      <button
        key="Eraser"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Eraser"}
        aria-label="Eraser"
        title="Tap or drag across a stroke to delete it"
        onClick={() => toggleMode("Eraser")}
      >
        <Icon d="M16 3l5 5-11 11H5l-3-3L16 3zM9 10l5 5M10 21h11" join />
      </button>
    ),
    Swap: () => (
      <button
        key="Swap"
        type="button"
        class="tool pair"
        aria-label="Swap primary and secondary colour"
        onClick={() => pick({ ...tool, primary: tool.secondary, secondary: tool.primary })}
      >
        <span class="chip back" style={{ background: PALETTE[tool.secondary] }} />
        <span class="chip front" style={{ background: PALETTE[tool.primary] }} />
      </button>
    ),
    Undo: () => (
      <button
        key="Undo"
        type="button"
        class="tool"
        aria-label="Undo"
        title="Undo your last change (Ctrl+Z)"
        disabled={!history.canUndo}
        onClick={onUndo}
      >
        <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" join />
      </button>
    ),
    Redo: () => (
      <button
        key="Redo"
        type="button"
        class="tool"
        aria-label="Redo"
        title="Redo your last undone change (Ctrl+Shift+Z)"
        disabled={!history.canRedo}
        onClick={onRedo}
      >
        <Icon d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" join />
      </button>
    ),
    Share: () => (
      <button
        key="Share"
        type="button"
        class="tool"
        data-share-toggle
        aria-pressed={shareOpen}
        aria-label="Share"
        title="Share the board link, QR code and PIN"
        onClick={() => {
          onShare();
          if (!wide && expanded) expand(false);
        }}
      >
        <Icon d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4M18 5a2.5 2.5 0 11-.01 0M6 9.5a2.5 2.5 0 11-.01 0M18 16.5a2.5 2.5 0 11-.01 0" />
      </button>
    ),
    Level: () => (
      <LevelChip
        key="Level"
        level={view.level}
        contentLevels={view.contentLevels}
        onPick={onLevel}
      />
    ),
    Connection: () => (
      <span
        key="Connection"
        class="status"
        data-connection={connection}
        role="status"
        aria-label={CONNECTION_LABEL[connection]}
        title={CONNECTION_LABEL[connection]}
      />
    ),
    Expand: () => (
      <button
        key="Expand"
        type="button"
        class="tool expand"
        aria-expanded={expanded}
        aria-label={expanded ? "Fewer tools" : "More tools"}
        title={expanded ? "Fewer tools" : "More tools"}
        onClick={() => expand(!expanded)}
      >
        <Icon d={expanded ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} join />
      </button>
    ),
  };

  return (
    <>
      <div class="toolbar" data-layout={layout} role="toolbar" aria-label="Drawing tools">
        {toolbarRows(layout).map((row, index) => (
          <div key={row.join()} class="toolbar-row" data-row={index}>
            {row.map((control) => controls[control]())}
          </div>
        ))}
      </div>
      <div class="presence-floater">
        <FollowPill presence={presence} onStop={() => onFollow(undefined)} />
        <PresenceStrip presence={presence} onFollow={onFollow} />
      </div>
    </>
  );
}
