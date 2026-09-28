import { MAX_STICKY_BYTES } from "@stallion/schema";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { STICKY_FONT_FAMILY } from "./sticky";
import type { StickyEdit } from "./surface";

export const KEYBOARD_GAP_PX = 12;

const DONE_ROW_PX = 52;

type TextEditorProps = {
  edit: StickyEdit | undefined;
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
  latest.current = edit;

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
    const visibleTop = viewport.offsetTop + KEYBOARD_GAP_PX;
    const visibleBottom = viewport.offsetTop + viewport.height - KEYBOARD_GAP_PX;
    const height = Math.max(current.height, areaRef.current?.scrollHeight ?? 0);
    const overflow = current.top + height + DONE_ROW_PX - visibleBottom;
    if (overflow <= 0) return;
    const room = Math.max(0, current.top - visibleTop);
    if (room > 0) onPan(0, -Math.min(overflow, room));
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
        aria-label="Note text"
        spellcheck
        maxLength={MAX_STICKY_BYTES}
        tabIndex={edit ? 0 : -1}
        style={
          edit && {
            font: `${edit.fontPx}px ${STICKY_FONT_FAMILY}`,
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
