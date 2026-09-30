import { useEffect, useRef, useState } from "preact/hooks";
import { levelOptions } from "./level";
import {
  FLYOUT_CLOSE_MS,
  FLYOUT_OPEN_MS,
  type FlyoutPlacement,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  placeFlyout,
} from "./level-objects";
import { placementStyle, usePlacement } from "./popover";
import type { Surface } from "./surface";

export type LevelBrowser = Pick<Surface, "levelObjects" | "preview" | "jumpTo" | "highlight">;

type LevelChipProps = {
  level: number;
  contentLevels: readonly number[];
  onPick: (level: number) => void;
  browser: LevelBrowser;
};

const LIST_MAX_PX = 440;

type Flyout = { level: number; placement: FlyoutPlacement };

type LevelFlyoutProps = {
  flyout: Flyout;
  origin: DOMRect | undefined;
  browser: LevelBrowser;
  onEnter: () => void;
  onLeave: () => void;
  onJump: (objectId: string) => void;
};

function LevelFlyout({ flyout, origin, browser, onEnter, onLeave, onJump }: LevelFlyoutProps) {
  const { items, more } = browser.levelObjects(flyout.level);
  const { placement } = flyout;
  useEffect(() => () => browser.highlight(undefined), [browser]);
  return (
    <div
      class="level-flyout"
      data-side={placement.side}
      role="listbox"
      aria-label={`Objects on level ${flyout.level}`}
      style={{
        left: `${placement.left - (origin?.left ?? 0)}px`,
        top: `${placement.top - (origin?.top ?? 0)}px`,
        maxHeight: `${placement.maxHeight}px`,
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocusIn={onEnter}
      onFocusOut={onLeave}
    >
      {items.map((item) => (
        <button
          key={item.objectId}
          type="button"
          role="option"
          aria-selected={false}
          class="level-object"
          data-object-id={item.objectId}
          onPointerEnter={() => browser.highlight(item.objectId)}
          onPointerLeave={() => browser.highlight(undefined)}
          onFocus={() => browser.highlight(item.objectId)}
          onBlur={() => browser.highlight(undefined)}
          onClick={() => onJump(item.objectId)}
        >
          <img
            class="level-preview"
            src={browser.preview(item.objectId)}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            alt=""
          />
          <span class="level-object-label">{item.label}</span>
        </button>
      ))}
      {more > 0 && <span class="level-more">and {more} more</span>}
    </div>
  );
}

export function LevelChip({ level, contentLevels, onPick, browser }: LevelChipProps) {
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<Flyout | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const placement = usePlacement(open, rootRef, LIST_MAX_PX);

  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };

  const showFlyout = (target: HTMLElement, forLevel: number) => {
    const list = listRef.current;
    if (!list) return;
    setFlyout({
      level: forLevel,
      placement: placeFlyout(target.getBoundingClientRect(), list.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });
  };

  const scheduleOpen = (target: HTMLElement, forLevel: number) => {
    clearTimers();
    if (flyout?.level === forLevel) return;
    openTimer.current = setTimeout(() => showFlyout(target, forLevel), FLYOUT_OPEN_MS);
  };

  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(undefined), FLYOUT_CLOSE_MS);
  };

  const keepFlyout = () => clearTimeout(closeTimer.current);

  const closeList = () => {
    clearTimers();
    setFlyout(undefined);
    setOpen(false);
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!open || !placement) return;
    currentRef.current?.scrollIntoView({ block: "nearest" });
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      closeList();
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!flyout) {
        closeList();
        return;
      }
      const owner = listRef.current?.querySelector<HTMLElement>(`[data-level="${flyout.level}"]`);
      owner?.focus();
      clearTimers();
      setFlyout(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, flyout]);

  return (
    <div class="level" ref={rootRef}>
      <button
        type="button"
        class="level-chip"
        aria-label={`Zoom level ${level}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Zoom level: 0 is the starting zoom, negative is zoomed in"
        onClick={() => (open ? closeList() : setOpen(true))}
      >
        {level}
      </button>
      {open && (
        <div
          ref={listRef}
          class="level-list"
          data-side={placement?.side}
          style={placementStyle(placement)}
          role="listbox"
          aria-label="Zoom levels"
          onScroll={() => setFlyout(undefined)}
        >
          {levelOptions(level, contentLevels).map((option) => (
            <button
              key={option.level}
              ref={option.current ? currentRef : null}
              type="button"
              role="option"
              aria-selected={option.current}
              aria-label={`Level ${option.level}${option.hasContent ? ", has strokes" : ""}`}
              class="level-option"
              data-level={option.level}
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                if (option.hasContent) scheduleOpen(event.currentTarget, option.level);
                else scheduleClose();
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") scheduleClose();
              }}
              onFocus={(event) => {
                clearTimers();
                if (option.hasContent) showFlyout(event.currentTarget, option.level);
                else setFlyout(undefined);
              }}
              onClick={() => {
                closeList();
                onPick(option.level);
              }}
            >
              <span>{option.level}</span>
              {option.hasContent && <span class="level-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      {open && flyout && (
        <LevelFlyout
          flyout={flyout}
          origin={rootRef.current?.getBoundingClientRect()}
          browser={browser}
          onEnter={keepFlyout}
          onLeave={scheduleClose}
          onJump={(objectId) => {
            closeList();
            browser.jumpTo(objectId);
          }}
        />
      )}
    </div>
  );
}
