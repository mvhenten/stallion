import { MAX_WIDTH, MIN_WIDTH, parseHref, TEXT_FONTS, type TextFont } from "@stallion/schema";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ScreenBox, TextTarget } from "./surface";
import { FONT_STEP, type TextChange } from "./text-change";
import { canvasFont } from "./wrap";

export const CONTEXT_GAP_PX = 8;

export const CONTEXT_GUTTER_PX = 8;

const AVOID = [".toolbar", ".presence-floater"];

export type ContextPlacement = { left: number; top: number; side: "Above" | "Below" | "Inside" };

type Size = { width: number; height: number };

const overlaps = (a: ScreenBox, b: ScreenBox): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export const placeContextToolbar = (
  anchor: ScreenBox,
  size: Size,
  viewport: ScreenBox,
  avoid: readonly ScreenBox[],
): ContextPlacement => {
  const minLeft = viewport.left + CONTEXT_GUTTER_PX;
  const maxLeft = Math.max(minLeft, viewport.right - CONTEXT_GUTTER_PX - size.width);
  const centre =
    (Math.max(anchor.left, viewport.left) + Math.min(anchor.right, viewport.right)) / 2;
  const left = Math.min(maxLeft, Math.max(minLeft, centre - size.width / 2));
  const minTop = viewport.top + CONTEXT_GUTTER_PX;
  const maxTop = viewport.bottom - CONTEXT_GUTTER_PX - size.height;
  const clear = (top: number): boolean => {
    if (top < minTop || top > maxTop) return false;
    const box = { left, top, right: left + size.width, bottom: top + size.height };
    return !avoid.some((other) => overlaps(box, other));
  };
  const above = anchor.top - CONTEXT_GAP_PX - size.height;
  if (clear(above)) return { left, top: above, side: "Above" };
  const below = anchor.bottom + CONTEXT_GAP_PX;
  if (clear(below)) return { left, top: below, side: "Below" };
  const middle = (viewport.top + viewport.bottom) / 2;
  const span = { left, right: left + size.width };
  const topOverlays = avoid.filter(
    (other) =>
      (other.top + other.bottom) / 2 < middle && other.left < span.right && span.left < other.right,
  );
  const inside = Math.max(minTop, ...topOverlays.map((other) => other.bottom + CONTEXT_GAP_PX));
  return { left, top: Math.max(minTop, Math.min(inside, maxTop)), side: "Inside" };
};

const viewportBox = (): ScreenBox => {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }
  return {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    right: viewport.offsetLeft + viewport.width,
    bottom: viewport.offsetTop + viewport.height,
  };
};

const avoidBoxes = (): ScreenBox[] =>
  AVOID.flatMap((selector) => {
    const element = document.querySelector(selector);
    if (!element) return [];
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return right > left && bottom > top ? [{ left, top, right, bottom }] : [];
  });

const samePlacement = (a: ContextPlacement | undefined, b: ContextPlacement): boolean =>
  a !== undefined && a.left === b.left && a.top === b.top && a.side === b.side;

const keepFocus = (event: Event) => {
  if (event.target instanceof HTMLInputElement) return;
  event.preventDefault();
};

type ContextToolbarProps = {
  anchor: ScreenBox;
  label: string;
  children: ComponentChildren;
};

export function ContextToolbar({ anchor, label, children }: ContextToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ContextPlacement | undefined>(undefined);
  const [, setViewportTick] = useState(0);

  useEffect(() => {
    const bump = () => setViewportTick((tick) => tick + 1);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", bump);
    viewport?.addEventListener("scroll", bump);
    window.addEventListener("resize", bump);
    return () => {
      viewport?.removeEventListener("resize", bump);
      viewport?.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const next = placeContextToolbar(
      anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      viewportBox(),
      avoidBoxes(),
    );
    setPlacement((previous) => (samePlacement(previous, next) ? previous : next));
  });

  const style: JSX.CSSProperties = placement
    ? { left: `${placement.left}px`, top: `${placement.top}px` }
    : { left: "0px", top: "0px", visibility: "hidden" };

  return (
    <div
      ref={ref}
      class="context-toolbar"
      role="toolbar"
      aria-label={label}
      data-side={placement?.side}
      style={style}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
    >
      {children}
    </div>
  );
}

const FONT_LABEL: Readonly<Record<TextFont, string>> = {
  Sans: "Sans",
  Serif: "Serif",
  Mono: "Mono",
  Hand: "Hand",
};

const faceStyle = (font: TextFont, px: number) => ({
  font: canvasFont(px, { font, bold: false, italic: false }),
});

const LINK_ICON =
  "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1";

function LinkField({
  href,
  onSave,
  onClose,
}: {
  href: string | undefined;
  onSave: (href: string | undefined) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(href ?? "");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const save = () => {
    if (text.trim() === "") {
      onSave(undefined);
      onClose();
      return;
    }
    const parsed = parseHref(text);
    setInvalid(parsed === undefined);
    if (parsed === undefined) return;
    onSave(parsed);
    onClose();
  };
  return (
    <div class="context-row link-row">
      <input
        ref={inputRef}
        class="link-field"
        type="url"
        inputMode="url"
        spellcheck={false}
        autocomplete="off"
        placeholder="https://example.com"
        aria-label="Link address"
        aria-invalid={invalid}
        aria-describedby={invalid ? "link-error" : undefined}
        value={text}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") onClose();
        }}
      />
      <button type="button" class="context-action" onClick={save}>
        Save
      </button>
      {href !== undefined && (
        <button
          type="button"
          class="context-action"
          onClick={() => {
            onSave(undefined);
            onClose();
          }}
        >
          Remove
        </button>
      )}
      {invalid && (
        <p id="link-error" class="link-error" role="alert">
          Enter a web address such as https://example.com; only http and https links work.
        </p>
      )}
    </div>
  );
}

type Panel = "None" | "Font" | "Link";

type TextToolbarProps = {
  target: TextTarget;
  anchor: ScreenBox;
  onChange: (change: TextChange) => void;
};

export function TextToolbar({ target, anchor, onChange }: TextToolbarProps) {
  const [panel, setPanel] = useState<Panel>("None");
  const { style, href } = target;
  const toggle = (next: Panel) => setPanel(panel === next ? "None" : next);
  return (
    <ContextToolbar anchor={anchor} label={target.kind === "Sticky" ? "Note text" : "Text"}>
      <div class="context-row">
        <button
          type="button"
          class="tool font-pick"
          aria-label={`Font: ${FONT_LABEL[style.font]}`}
          aria-expanded={panel === "Font"}
          title="Font"
          style={faceStyle(style.font, 17)}
          onClick={() => toggle("Font")}
        >
          Aa
        </button>
        <button
          type="button"
          class="tool"
          aria-label="Bold"
          aria-pressed={style.bold}
          title="Bold (Ctrl+B)"
          onClick={() => onChange({ bold: !style.bold })}
        >
          <b class="glyph">B</b>
        </button>
        <button
          type="button"
          class="tool"
          aria-label="Italic"
          aria-pressed={style.italic}
          title="Italic (Ctrl+I)"
          onClick={() => onChange({ italic: !style.italic })}
        >
          <i class="glyph serif">I</i>
        </button>
        <button
          type="button"
          class="tool"
          aria-label="Link"
          aria-pressed={href !== undefined}
          aria-expanded={panel === "Link"}
          title={href ?? "Add a link"}
          onClick={() => toggle("Link")}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d={LINK_ICON}
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <span class="context-divider" aria-hidden="true" />
        <button
          type="button"
          class="tool"
          aria-label="Smaller text"
          disabled={target.width <= MIN_WIDTH}
          onClick={() => onChange({ fontScale: 1 / FONT_STEP })}
        >
          <span class="glyph">−</span>
        </button>
        <output class="font-size" aria-label="Text size">
          {Math.round(target.sizePx)}
        </output>
        <button
          type="button"
          class="tool"
          aria-label="Larger text"
          disabled={target.width >= MAX_WIDTH}
          onClick={() => onChange({ fontScale: FONT_STEP })}
        >
          <span class="glyph">+</span>
        </button>
        <button
          type="button"
          class="tool fit-toggle"
          aria-label="Fit text to the frame"
          aria-pressed={style.fit === "Auto"}
          title="Fit: size the text to the frame"
          onClick={() => onChange({ fit: style.fit === "Auto" ? "Fixed" : "Auto" })}
        >
          Fit
        </button>
      </div>
      {panel === "Font" && (
        <div class="context-row">
          {TEXT_FONTS.map((font) => (
            <button
              key={font}
              type="button"
              class="tool font-option"
              aria-label={`${FONT_LABEL[font]} font`}
              aria-pressed={style.font === font}
              style={faceStyle(font, 16)}
              onClick={() => {
                onChange({ font });
                setPanel("None");
              }}
            >
              {FONT_LABEL[font]}
            </button>
          ))}
        </div>
      )}
      {panel === "Link" && (
        <LinkField
          href={href}
          onSave={(next) => onChange({ href: next })}
          onClose={() => setPanel("None")}
        />
      )}
    </ContextToolbar>
  );
}
