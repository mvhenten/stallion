import { MAX_STICKY_BYTES } from "@stallion/schema";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { TextEdit } from "./surface";
import { FONT_FAMILY } from "./wrap";

export const KEYBOARD_GAP_PX = 12;

const DONE_ROW_PX = 52;

const OVERLAYS = [".toolbar", ".presence-floater"];

type Band = { top: number; bottom: number };

type Rect = Band & { left: number; right: number };

const covers = (editor: Rect, overlay: Rect): boolean =>
  overlay.right > overlay.left &&
  overlay.bottom > overlay.top &&
  overlay.left < editor.right &&
  editor.left < overlay.right &&
  overlay.top < editor.bottom &&
  editor.top < overlay.bottom;

export const freeBand = (editor: Rect, visible: Band, overlays: readonly Rect[]): Band => {
  const middle = (visible.top + visible.bottom) / 2;
  const hit = overlays.filter((overlay) => covers(editor, overlay));
  const above = hit.filter((overlay) => (overlay.top + overlay.bottom) / 2 < middle);
  const below = hit.filter((overlay) => (overlay.top + overlay.bottom) / 2 >= middle);
  return {
    top: Math.max(visible.top, ...above.map((overlay) => overlay.bottom + KEYBOARD_GAP_PX)),
    bottom: Math.min(visible.bottom, ...below.map((overlay) => overlay.top - KEYBOARD_GAP_PX)),
  };
};

export const revealShift = (top: number, height: number, band: Band): number => {
  const bottom = top + height;
  if (top < band.top) return Math.max(0, Math.min(band.top - top, band.bottom - bottom));
  const overflow = bottom - band.bottom;
  if (overflow <= 0) return 0;
  return -Math.min(overflow, Math.max(0, top - band.top));
};

const overlayRects = (): Rect[] =>
  OVERLAYS.flatMap((selector) => {
    const element = document.querySelector(selector);
    return element ? [element.getBoundingClientRect()] : [];
  });

type TextEditorProps = {
  edit: TextEdit | undefined;
  areaRef: RefObject<HTMLTextAreaElement>;
  onInput: (text: string) => void;
  onDone: () => void;
  onPan: (dx: number, dy: number) => void;
};

export const openEditor = (area: HTMLTextAreaElement | null, text: string): void => {
  if (!area) return;
  area.value = text;
  area.focus({ preventScroll: true });
  const end = area.value.length;
  area.setSelectionRange(end, end);
};

export function TextEditor({ edit, areaRef, onInput, onDone, onPan }: TextEditorProps) {
  const latest = useRef(edit);
  const panned = useRef({ from: edit?.top, by: 0 });
  latest.current = edit;
  if (panned.current.from !== edit?.top) panned.current = { from: edit?.top, by: 0 };

  const grow = () => {
    const area = areaRef.current;
    const current = latest.current;
    if (!area || !current) return;
    area.style.height = `${current.height}px`;
    if (area.scrollHeight > current.height) area.style.height = `${area.scrollHeight}px`;
  };

  const reveal = () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    const viewport = window.visualViewport;
    const current = latest.current;
    if (!viewport || !current) return;
    const height = Math.max(current.height, areaRef.current?.scrollHeight ?? 0) + DONE_ROW_PX;
    const visible = {
      top: viewport.offsetTop + KEYBOARD_GAP_PX,
      bottom: viewport.offsetTop + viewport.height - KEYBOARD_GAP_PX,
    };
    const editor = {
      left: current.left,
      right: current.left + current.width,
      top: current.top + panned.current.by,
      bottom: current.top + panned.current.by + height,
    };
    const shift = revealShift(editor.top, height, freeBand(editor, visible, overlayRects()));
    if (shift === 0) return;
    panned.current.by += shift;
    onPan(0, shift);
  };

  useLayoutEffect(grow);

  const editing = edit?.objectId;
  useEffect(() => {
    if (editing === undefined) return;
    const viewport = window.visualViewport;
    reveal();
    viewport?.addEventListener("resize", reveal);
    viewport?.addEventListener("scroll", reveal);
    window.addEventListener("scroll", reveal);
    return () => {
      viewport?.removeEventListener("resize", reveal);
      viewport?.removeEventListener("scroll", reveal);
      window.removeEventListener("scroll", reveal);
    };
  }, [editing]);

  const style = edit
    ? {
        left: `${edit.left}px`,
        top: `${edit.top}px`,
        width: `${edit.width}px`,
      }
    : undefined;

  return (
    <div class={edit ? "sticky-editor" : "sticky-editor idle"} style={style}>
      <textarea
        ref={areaRef}
        class="sticky-text"
        aria-label={edit?.label ?? "Note text"}
        spellcheck
        maxLength={MAX_STICKY_BYTES}
        tabIndex={edit ? 0 : -1}
        style={
          edit && {
            font: `${edit.fontPx}px ${FONT_FAMILY}`,
            lineHeight: `${edit.lineHeightPx}px`,
            padding: `${edit.padPx}px`,
            color: edit.ink,
            caretColor: edit.ink,
            background: edit.background,
          }
        }
        onInput={(event) => {
          onInput(event.currentTarget.value);
          grow();
          reveal();
        }}
        onBlur={onDone}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
      />
      {edit && (
        <button
          type="button"
          class="sticky-done"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDone}
        >
          Done
        </button>
      )}
    </div>
  );
}
