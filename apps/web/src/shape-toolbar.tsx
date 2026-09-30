import {
  FILLABLE,
  PENCIL_PX,
  type PencilSize,
  parseRgbHex,
  rgbHex,
  STROKE_STYLES,
  type StrokeStyle,
} from "@stallion/schema";
import type { ComponentChildren, JSX } from "preact";
import type { ShapeChange } from "./shape";
import type { ScreenBox, ShapeTarget } from "./surface";
import { ContextToolbar } from "./text-toolbar";

const SIZES: readonly PencilSize[] = ["Small", "Medium", "Large"];

const DOT_PX: Readonly<Record<PencilSize, number>> = { Small: 4, Medium: 9, Large: 16 };

const STYLE_LABEL: Readonly<Record<StrokeStyle, string>> = {
  Pen: "Pen line",
  Highlighter: "Highlighter line",
  Dashed: "Dashed line",
  Uniform: "Even line",
};

const STYLE_WAVE = "M3 16c3-6 6-6 9-2s6 4 9-2";

const STYLE_STROKE: Readonly<Record<StrokeStyle, JSX.SVGAttributes<SVGPathElement>>> = {
  Pen: { "stroke-width": "3.5", "stroke-linecap": "round" },
  Highlighter: { "stroke-width": "6", "stroke-opacity": "0.45" },
  Dashed: { "stroke-width": "2", "stroke-linecap": "round", "stroke-dasharray": "2 4" },
  Uniform: { "stroke-width": "2.5", "stroke-linecap": "round" },
};

type ColourInputProps = {
  className: string;
  title: string;
  colour?: string;
  children?: ComponentChildren;
  label: string;
  rgb: number;
  onPreview: (rgb: number) => void;
  onPick: (rgb: number) => void;
};

function ColourInput({
  className,
  title,
  colour,
  children,
  label,
  rgb,
  onPreview,
  onPick,
}: ColourInputProps) {
  const read = (event: JSX.TargetedEvent<HTMLInputElement>, then: (rgb: number) => void) => {
    const next = parseRgbHex(event.currentTarget.value);
    if (next !== undefined) then(next);
  };
  return (
    <label class={className} title={title} style={colour ? { color: colour } : undefined}>
      {children}
      <input
        type="color"
        aria-label={label}
        value={rgbHex(rgb)}
        onInput={(event) => read(event, onPreview)}
        onChange={(event) => read(event, onPick)}
      />
    </label>
  );
}

type ShapeToolbarProps = {
  target: ShapeTarget;
  anchor: ScreenBox;
  onChange: (change: ShapeChange) => void;
  onPreview: (change: ShapeChange | undefined) => void;
};

export function ShapeToolbar({ target, anchor, onChange, onPreview }: ShapeToolbarProps) {
  const fillable = FILLABLE[target.shape];
  const filled = fillable && target.fill === "Tint";
  const custom = filled ? target.fillRgb : undefined;
  const percent = Math.round(target.opacity * 100);
  return (
    <ContextToolbar anchor={anchor} label="Shape">
      <div class="context-row">
        <ColourInput
          className="tool swatch shape-swatch"
          title={`Line colour ${rgbHex(target.rgb)}`}
          colour={rgbHex(target.rgb)}
          label={`Line colour, now ${rgbHex(target.rgb)}`}
          rgb={target.rgb}
          onPreview={(rgb) => onPreview({ rgb })}
          onPick={(rgb) => onChange({ rgb })}
        >
          <span class="stroke-ring" aria-hidden="true" />
        </ColourInput>
        {fillable && (
          <button
            type="button"
            class="tool"
            aria-label="Outline"
            aria-pressed={target.outline}
            title={filled ? "Outline on or off" : "A shape without fill keeps its outline"}
            disabled={!filled}
            onClick={() => onChange({ outline: !target.outline })}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect
                x="4"
                y="4"
                width="16"
                height="16"
                rx="3"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-dasharray={target.outline ? undefined : "2 3"}
              />
            </svg>
          </button>
        )}
        {fillable && (
          <>
            <span class="context-divider" aria-hidden="true" />
            <button
              type="button"
              class="tool"
              aria-label="No fill"
              aria-pressed={!filled}
              title="No fill"
              onClick={() => onChange({ fill: "None" })}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="M5 19L19 5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              class="tool"
              aria-label="Tint fill"
              aria-pressed={filled && custom === undefined}
              title="Tint: a light wash of the line colour"
              onClick={() => onChange({ fill: "Tint" })}
            >
              <span class="tint-chip" aria-hidden="true" style={{ color: rgbHex(target.rgb) }} />
            </button>
            <ColourInput
              className={
                custom === undefined
                  ? "tool swatch colour-wheel shape-swatch"
                  : "tool swatch shape-swatch"
              }
              title={custom === undefined ? "Fill with any colour" : `Fill ${rgbHex(custom)}`}
              label={custom === undefined ? "Fill colour" : `Fill colour, now ${rgbHex(custom)}`}
              rgb={custom ?? target.rgb}
              onPreview={(fillRgb) => onPreview({ fillRgb })}
              onPick={(fillRgb) => onChange({ fillRgb })}
            >
              {custom !== undefined && (
                <span class="swatch-fill" style={{ background: rgbHex(custom) }} />
              )}
            </ColourInput>
          </>
        )}
      </div>
      <div class="context-row opacity-row">
        <input
          class="opacity-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          aria-label="Opacity"
          aria-valuetext={`${percent}%`}
          value={percent}
          onInput={(event) => onPreview({ opacity: event.currentTarget.valueAsNumber / 100 })}
          onChange={(event) => onChange({ opacity: event.currentTarget.valueAsNumber / 100 })}
        />
        <output class="font-size opacity-value" aria-hidden="true">
          {percent}%
        </output>
      </div>
      <div class="context-row">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            class="tool"
            aria-label={`${size} line`}
            aria-pressed={target.width === PENCIL_PX[size]}
            onClick={() => onChange({ width: PENCIL_PX[size] })}
          >
            <span class="dot" style={{ width: DOT_PX[size], height: DOT_PX[size] }} />
          </button>
        ))}
        <span class="context-divider" aria-hidden="true" />
        {STROKE_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            class="tool"
            aria-label={STYLE_LABEL[style]}
            aria-pressed={target.style === style}
            onClick={() => onChange({ style })}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d={STYLE_WAVE} fill="none" stroke="currentColor" {...STYLE_STROKE[style]} />
            </svg>
          </button>
        ))}
      </div>
    </ContextToolbar>
  );
}
