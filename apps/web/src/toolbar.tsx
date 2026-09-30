import {
  PENCIL_PX,
  rgbHex,
  SHAPE_KINDS,
  type ShapeKind,
  STROKE_STYLES,
  type StrokeStyle,
} from "@stallion/schema";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ColourControl } from "./colour-control";
import { type LevelBrowser, LevelChip } from "./level-chip";
import { usePaletteFit } from "./palette-fit";
import type { Presence } from "./presence";
import { FollowPill, PresenceStrip } from "./presence-strip";
import {
  PENCIL_SIZES,
  sliderToWidth,
  WIDTH_PRESETS,
  WIDTH_SLIDER_STEPS,
  widthToSlider,
} from "./stroke";
import type { SurfaceView, Tool } from "./surface";
import { CONNECTION_LABEL, type Connection } from "./sync";
import {
  type Control,
  expandedAfterPick,
  loadExpanded,
  loadMode,
  saveExpanded,
  saveMode,
  saveStyle,
  type ToolbarMode,
  toolbarLayout,
  toolbarRows,
  WIDE_QUERY,
} from "./toolbar-layout";

const DOT_PX = { Small: 4, Medium: 9, Large: 16 } as const;

const STYLE_TITLE: Record<StrokeStyle, string> = {
  Pen: "Pen: pressure-sensitive ink",
  Highlighter: "Highlighter: translucent ink that darkens what it crosses",
  Dashed: "Dashed: an even dashed line",
  Uniform: "Uniform: ink of even width",
};

const PEN_NIB = "M2.5 16.5C5.5 7.5 9 7.5 12 11.5s5.5 5 9.5-2c-2 9.5-6 10-9.5 6S6.5 11 2.5 16.5z";

const STYLE_WAVE = "M3 16c3-6 6-6 9-2s6 4 9-2";

const STYLE_STROKE: Record<Exclude<StrokeStyle, "Pen">, JSX.SVGAttributes<SVGPathElement>> = {
  Highlighter: { "stroke-width": "6", "stroke-opacity": "0.45" },
  Dashed: { "stroke-width": "2", "stroke-linecap": "round", "stroke-dasharray": "2 4" },
  Uniform: { "stroke-width": "2.5", "stroke-linecap": "round" },
};

function StyleIcon({ style }: { style: StrokeStyle }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {style === "Pen" ? (
        <path d={PEN_NIB} fill="currentColor" />
      ) : (
        <path d={STYLE_WAVE} fill="none" stroke="currentColor" {...STYLE_STROKE[style]} />
      )}
    </svg>
  );
}

const SHAPE_ICON: Record<ShapeKind, string> = {
  Rectangle: "M4 6h16v12H4z",
  Ellipse: "M2 12a10 7 0 1 0 20 0a10 7 0 1 0-20 0",
  Line: "M5 19L19 5",
  Arrow: "M5 19L19 5M10 5h9v9",
};

function FillIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        fill={on ? "currentColor" : "none"}
        fill-opacity="0.35"
        stroke="currentColor"
        stroke-width="2"
      />
      {!on && <path d="M5 19L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />}
    </svg>
  );
}

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
  levels: LevelBrowser;
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
  levels,
  shareOpen,
  onShare,
  presence,
  onFollow,
}: ToolbarProps) {
  const wide = useWide();
  const [expanded, setExpanded] = useState(() => loadExpanded(storage));
  const [mode, setMode] = useState<ToolbarMode>(() => loadMode(storage));
  const layout = toolbarLayout(mode, wide, expanded);
  const palette = layout === "Palette";
  const barRef = useRef<HTMLDivElement>(null);
  usePaletteFit(barRef, palette);

  const expand = (next: boolean) => {
    setExpanded(next);
    saveExpanded(storage, next);
  };
  const flip = () => {
    const next = palette ? "Quick" : "Palette";
    setMode(next);
    saveMode(storage, next);
  };
  const pick = (next: Tool) => {
    onChange(next);
    if (palette) return;
    const after = expandedAfterPick(wide, expanded);
    if (after !== expanded) expand(after);
  };
  const drawMode: Tool["mode"] = tool.mode === "Shape" ? "Shape" : "Pencil";
  const drawing = tool.mode === "Pencil" || tool.mode === "Shape";
  const pickStyle = (style: StrokeStyle) => {
    saveStyle(storage, style);
    pick({ ...tool, style, mode: drawMode });
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
            aria-pressed={drawing && tool.width === PENCIL_PX[size]}
            aria-label={`${size} pencil`}
            class="tool"
            onClick={() => pick({ ...tool, width: PENCIL_PX[size], mode: drawMode })}
          >
            <span class="dot" style={{ width: DOT_PX[size], height: DOT_PX[size] }} />
          </button>
        ))}
      </fieldset>
    ),
    Width: () => (
      <fieldset key="Width" class="group width" aria-label="Stroke width">
        {WIDTH_PRESETS.map((width) => (
          <button
            key={width}
            type="button"
            aria-pressed={drawing && tool.width === width}
            aria-label={`${width} px pencil`}
            class="tool width-preset"
            onClick={() => pick({ ...tool, width, mode: drawMode })}
          >
            {width}
          </button>
        ))}
        <input
          class="width-slider"
          type="range"
          min={0}
          max={WIDTH_SLIDER_STEPS}
          step={1}
          aria-label="Stroke width"
          aria-valuetext={`${tool.width} px`}
          value={widthToSlider(tool.width)}
          onInput={(event) =>
            onChange({
              ...tool,
              width: sliderToWidth(Number(event.currentTarget.value)),
              mode: drawMode,
            })
          }
        />
        <output class="width-value" aria-live="polite">
          {tool.width} px
        </output>
      </fieldset>
    ),
    Styles: () => (
      <fieldset key="Styles" class="group" aria-label="Stroke style">
        {STROKE_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={drawing && tool.style === style}
            aria-label={`${style} style`}
            title={STYLE_TITLE[style]}
            class="tool"
            data-stroke-style={style}
            onClick={() => pickStyle(style)}
          >
            <StyleIcon style={style} />
          </button>
        ))}
      </fieldset>
    ),
    Shapes: () => (
      <fieldset key="Shapes" class="group" aria-label="Shape">
        {SHAPE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={tool.mode === "Shape" && tool.shape === kind}
            aria-label={kind}
            title={`Drag to draw a ${kind.toLowerCase()}`}
            class="tool"
            data-shape={kind}
            onClick={() =>
              pick({
                ...tool,
                shape: kind,
                mode: tool.mode === "Shape" && tool.shape === kind ? "Pencil" : "Shape",
              })
            }
          >
            <Icon d={SHAPE_ICON[kind]} join />
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tool.fill === "Tint"}
          aria-label="Fill shapes"
          title="Fill rectangles and ellipses with a light tint of the colour"
          class="tool"
          onClick={() => pick({ ...tool, fill: tool.fill === "Tint" ? "None" : "Tint" })}
        >
          <FillIcon on={tool.fill === "Tint"} />
        </button>
      </fieldset>
    ),
    Colour: () => (
      <ColourControl
        key="Colour"
        primary={tool.primary}
        secondary={tool.secondary}
        beside={palette}
        onPrimary={(primary) => onChange({ ...tool, primary })}
        onSecondary={(secondary) => onChange({ ...tool, secondary })}
      />
    ),
    Pencil: () => (
      <button
        key="Pencil"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Pencil"}
        aria-label={`${tool.style} pencil, ${tool.width} px`}
        title="Draw"
        onClick={() => pick({ ...tool, mode: "Pencil" })}
      >
        <Icon d="M4 20l1-5L16 4l4 4L9 19l-5 1zM14 6l4 4" join />
      </button>
    ),
    Sticky: () => (
      <button
        key="Sticky"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Sticky"}
        aria-label="Sticky note"
        title="Tap to place a note in the current colour, tap a note to write on it"
        onClick={() => toggleMode("Sticky")}
      >
        <Icon d="M4 4h16v10l-6 6H4zM14 20v-6h6" join />
      </button>
    ),
    Text: () => (
      <button
        key="Text"
        type="button"
        class="tool"
        aria-pressed={tool.mode === "Text"}
        aria-label="Text tool"
        title="Tap to place text in the current colour, tap text to edit it"
        onClick={() => toggleMode("Text")}
      >
        <Icon d="M5 6V4h14v2M12 4v16M9 20h6" join />
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
        title="Tap a stroke, shape, note or text to select it, drag to move it, Delete to remove it; tap a note or text to edit it"
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
        title="Tap or drag across a stroke or shape to delete it"
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
        <span class="chip back" style={{ background: rgbHex(tool.secondary) }} />
        <span class="chip front" style={{ background: rgbHex(tool.primary) }} />
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
          if (layout === "Expanded") expand(false);
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
        browser={levels}
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
    Flip: () => (
      <button
        key="Flip"
        type="button"
        class="tool"
        data-toolbar-flip
        aria-label={palette ? "Show quick bar" : "Show palette"}
        title={palette ? "Switch to the quick bar" : "Switch to the palette"}
        onClick={flip}
      >
        <Icon
          d={palette ? "M3 5h18v6H3zM6 16h12M6 20h12" : "M4 3h6v18H4zM14 7h6M14 12h6M14 17h6"}
          join
        />
      </button>
    ),
  };

  return (
    <>
      <div
        ref={barRef}
        class="toolbar"
        data-layout={layout}
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation={palette ? "vertical" : "horizontal"}
      >
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
