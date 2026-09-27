import { useEffect, useRef, useState } from "preact/hooks";
import { levelOptions } from "./level";
import { placementStyle, usePlacement } from "./popover";

type LevelChipProps = {
  level: number;
  contentLevels: readonly number[];
  onPick: (level: number) => void;
};

const LIST_MAX_PX = 440;

export function LevelChip({ level, contentLevels, onPick }: LevelChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const placement = usePlacement(open, rootRef, LIST_MAX_PX);

  useEffect(() => {
    if (!open || !placement) return;
    currentRef.current?.scrollIntoView({ block: "nearest" });
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, placement]);

  return (
    <div class="level" ref={rootRef}>
      <button
        type="button"
        class="level-chip"
        aria-label={`Zoom level ${level}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Zoom level: 0 is the starting zoom, negative is zoomed in"
        onClick={() => setOpen(!open)}
      >
        {level}
      </button>
      {open && (
        <div
          class="level-list"
          data-side={placement?.side}
          style={placementStyle(placement)}
          role="listbox"
          aria-label="Zoom levels"
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
              onClick={() => {
                setOpen(false);
                onPick(option.level);
              }}
            >
              <span>{option.level}</span>
              {option.hasContent && <span class="level-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
