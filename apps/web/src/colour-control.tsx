import { parseRgbHex, rgbHex } from "@stallion/schema";
import { useEffect, useState } from "preact/hooks";
import {
  type CustomSlots,
  clearSlot,
  loadCustomSlots,
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

export type SlotControls = {
  slots: CustomSlots;
  tap: (index: number, current: number) => number | undefined;
  clear: (index: number) => void;
  track: (rgb: number) => void;
  stop: () => void;
};

export const useCustomSlots = (): SlotControls => {
  const [slots, setSlots] = useState<CustomSlots>(() => loadCustomSlots(storage));
  useEffect(() => saveCustomSlots(storage, slots), [slots]);
  return {
    slots,
    tap: (index, current) => {
      const next = tapSlot(slots, index, current);
      setSlots(next.slots);
      return next.pick;
    },
    clear: (index) => setSlots((now) => clearSlot(now, index)),
    track: (rgb) => setSlots((now) => trackColour(now, rgb)),
    stop: () => setSlots(stopTracking),
  };
};

type SwatchesProps = {
  count: number;
  primary: number;
  secondary: number;
  onPrimary: (rgb: number) => void;
  onSecondary: (rgb: number) => void;
};

export function ColourSwatches({
  count,
  primary,
  secondary,
  onPrimary,
  onSecondary,
}: SwatchesProps) {
  return (
    <fieldset class="group colours" aria-label="Colour">
      {STANDARD_COLOURS.slice(0, count).map(({ rgb, name }, index) => (
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
  );
}

export function ColourWheel({ primary, onMix }: { primary: number; onMix: (rgb: number) => void }) {
  return (
    <label
      class="tool swatch colour-wheel"
      title={`Colour ${rgbHex(primary)}: tap to mix any colour`}
    >
      <Fill rgb={primary} />
      <input
        type="color"
        aria-label={`Mix a colour, now ${rgbHex(primary)}`}
        value={rgbHex(primary)}
        onInput={(event) => {
          const rgb = parseRgbHex(event.currentTarget.value);
          if (rgb !== undefined) onMix(rgb);
        }}
      />
    </label>
  );
}

export function HexField({ rgb, onPick }: { rgb: number; onPick: (rgb: number) => void }) {
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

type SlotRowProps = {
  slots: CustomSlots;
  primary: number;
  onTap: (index: number) => void;
  onClear: (index: number) => void;
};

export function CustomSlotRow({ slots, primary, onTap, onClear }: SlotRowProps) {
  return (
    <fieldset class="group custom-slots" aria-label="Custom colours">
      {slots.colours.map((rgb, index) =>
        rgb === undefined ? (
          <button
            key={index}
            type="button"
            class="tool swatch slot empty"
            aria-label={`Empty slot ${index + 1}`}
            title="Tap to save the current colour here; it follows the wheel and hex until you pick another colour"
            onClick={() => onTap(index)}
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
              onClick={() => onTap(index)}
              onContextMenu={(event) => {
                event.preventDefault();
                onClear(index);
              }}
            >
              <Fill rgb={rgb} />
            </button>
            <button
              type="button"
              class="slot-clear"
              aria-label={`Clear slot ${index + 1}`}
              title="Clear this slot"
              onClick={() => onClear(index)}
            >
              <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
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
  );
}
