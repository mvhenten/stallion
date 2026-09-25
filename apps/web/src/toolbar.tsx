import { PALETTE, PENCIL_SIZES } from "./stroke";
import type { Tool } from "./surface";

const DOT_PX = { Small: 4, Medium: 9, Large: 16 } as const;

type ToolbarProps = { tool: Tool; onChange: (tool: Tool) => void };

export function Toolbar({ tool, onChange }: ToolbarProps) {
  return (
    <div class="toolbar" role="toolbar" aria-label="Drawing tools">
      <fieldset class="group" aria-label="Pencil size">
        {PENCIL_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={tool.size === size}
            aria-label={`${size} pencil`}
            class="tool"
            onClick={() => onChange({ ...tool, size, pan: false })}
          >
            <span class="dot" style={{ width: DOT_PX[size], height: DOT_PX[size] }} />
          </button>
        ))}
      </fieldset>
      <fieldset class="group" aria-label="Colour">
        {PALETTE.map((colour, index) => (
          <button
            key={colour}
            type="button"
            aria-pressed={tool.primary === index}
            aria-label={`Colour ${index + 1}`}
            title="Tap for primary, right-click or long-press for secondary"
            class={tool.secondary === index ? "tool swatch secondary" : "tool swatch"}
            style={{ background: colour }}
            onClick={() => onChange({ ...tool, primary: index })}
            onContextMenu={(event) => {
              event.preventDefault();
              onChange({ ...tool, secondary: index });
            }}
          />
        ))}
      </fieldset>
      <button
        type="button"
        class="tool"
        aria-pressed={tool.pan}
        aria-label="Pan tool"
        title="Drag with one finger to move the board"
        onClick={() => onChange({ ...tool, pan: !tool.pan })}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="tool pair"
        aria-label="Swap primary and secondary colour"
        onClick={() => onChange({ ...tool, primary: tool.secondary, secondary: tool.primary })}
      >
        <span class="chip back" style={{ background: PALETTE[tool.secondary] }} />
        <span class="chip front" style={{ background: PALETTE[tool.primary] }} />
      </button>
    </div>
  );
}
