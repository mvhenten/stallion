import { parseRgbHex, rgbHex } from "@stallion/schema";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  type CustomSlots,
  clearSlot,
  loadCustomSlots,
  type PopoverSpot,
  placeColourPopover,
  STANDARD_COLOURS,
  saveCustomSlots,
  stopTracking,
  tapSlot,
  trackColour,
} from "./colour-slots";

const storage = () => localStorage;

const LIGHT_LUMA = 0.85;

const isLight = (rgb: number): boolean => {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > LIGHT_LUMA;
};

function Fill({ rgb }: { rgb: number }) {
  return (
    <span
      class="swatch-fill"
      data-light={isLight(rgb) ? "" : undefined}
      style={{ background: rgbHex(rgb) }}
    />
  );
}

function HexField({ rgb, onPick }: { rgb: number; onPick: (rgb: number) => void }) {
  const [text, setText] = useState(() => rgbHex(rgb));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(rgbHex(rgb));
    setInvalid(false);
  }, [rgb]);
  const commit = () => {
    const parsed = parseRgbHex(text);
    setInvalid(parsed === undefined);
    if (parsed !== undefined) onPick(parsed);
  };
  return (
    <input
      class="hex-field"
      type="text"
      inputMode="text"
      spellcheck={false}
      autocomplete="off"
      maxLength={7}
      aria-label="Hex colour"
      aria-invalid={invalid}
      title={
        invalid ? "Enter a colour as #rrggbb, for example #123456" : "Type a colour as #rrggbb"
      }
      value={text}
      onInput={(event) => setText(event.currentTarget.value)}
      onChange={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

type ColourControlProps = {
  primary: number;
  secondary: number;
  beside: boolean;
  onPrimary: (rgb: number) => void;
  onSecondary: (rgb: number) => void;
};

export function ColourControl({
  primary,
  secondary,
  beside,
  onPrimary,
  onSecondary,
}: ColourControlProps) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<CustomSlots>(() => loadCustomSlots(storage));
  const [spot, setSpot] = useState<PopoverSpot | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSlots((current) => trackColour(current, primary)), [primary]);
  useEffect(() => saveCustomSlots(storage, slots), [slots]);

  const close = () => {
    setOpen(false);
    setSpot(undefined);
    setSlots(stopTracking);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const root = rootRef.current;
      const popover = popoverRef.current;
      if (!root || !popover) return;
      const bar = root.closest(".toolbar") ?? root;
      setSpot(
        placeColourPopover(
          root.getBoundingClientRect(),
          bar.getBoundingClientRect(),
          { width: popover.offsetWidth, height: popover.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
          beside,
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, beside]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const tap = (index: number) => {
    const next = tapSlot(slots, index, primary);
    setSlots(next.slots);
    if (next.pick !== undefined) onPrimary(next.pick);
  };
  const clear = (index: number) => setSlots((current) => clearSlot(current, index));

  return (
    <div class="colour-control" ref={rootRef}>
      <button
        type="button"
        class="tool swatch colour-face"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Colours, now ${rgbHex(primary)}`}
        title="Pick, mix or save a colour"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Fill rgb={primary} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          class="colour-popover"
          role="dialog"
          aria-label="Colours"
          style={
            spot
              ? { left: `${spot.left}px`, top: `${spot.top}px`, maxHeight: `${spot.maxHeight}px` }
              : { visibility: "hidden" }
          }
        >
          <fieldset class="colour-grid" aria-label="Standard colours">
            {STANDARD_COLOURS.map(({ rgb, name }, index) => (
              <button
                key={rgb}
                type="button"
                aria-pressed={primary === rgb}
                aria-label={`Colour ${index + 1}`}
                title={`${name}: tap for primary, right-click or long-press for secondary`}
                class={secondary === rgb ? "tool swatch secondary" : "tool swatch"}
                onClick={() => onPrimary(rgb)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSecondary(rgb);
                }}
              >
                <Fill rgb={rgb} />
              </button>
            ))}
          </fieldset>
          <p class="colour-caption">Custom: tap an empty slot, then mix</p>
          <fieldset class="colour-grid custom" aria-label="Custom colours">
            {slots.colours.map((rgb, index) =>
              rgb === undefined ? (
                <button
                  key={index}
                  type="button"
                  class="tool swatch slot empty"
                  aria-label={`Empty slot ${index + 1}`}
                  title="Tap to save the current colour here and keep it in step while you mix"
                  onClick={() => tap(index)}
                >
                  <span class="swatch-fill" />
                </button>
              ) : (
                <div key={index} class="slot-cell">
                  <button
                    type="button"
                    class="tool swatch slot"
                    data-tracking={slots.tracking === index ? "" : undefined}
                    aria-pressed={primary === rgb}
                    aria-label={`Slot ${index + 1}, ${rgbHex(rgb)}${slots.tracking === index ? ", following the mix" : ""}`}
                    title="Tap to use, right-click or long-press to clear"
                    onClick={() => tap(index)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      clear(index);
                    }}
                  >
                    <Fill rgb={rgb} />
                  </button>
                  <button
                    type="button"
                    class="slot-clear"
                    aria-label={`Clear slot ${index + 1}`}
                    title="Clear this slot"
                    onClick={() => clear(index)}
                  >
                    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                      <path
                        d="M3 3l6 6M9 3l-6 6"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ),
            )}
          </fieldset>
          <div class="colour-mix">
            <label class="tool swatch picker" title="Mix any colour">
              <span class="swatch-fill" />
              <input
                type="color"
                aria-label="Mix a colour"
                value={rgbHex(primary)}
                onInput={(event) => {
                  const rgb = parseRgbHex(event.currentTarget.value);
                  if (rgb !== undefined) onPrimary(rgb);
                }}
              />
            </label>
            <HexField rgb={primary} onPick={onPrimary} />
          </div>
        </div>
      )}
    </div>
  );
}
