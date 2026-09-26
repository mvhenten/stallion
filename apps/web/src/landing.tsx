import { useState } from "preact/hooks";
import { useLocation } from "wouter-preact";
import { randomBoardId } from "./id";
import { loadRecents, type RecentBoard, removeRecent, renameRecent, saveRecents } from "./recents";

const MINUTE_MS = 60_000;

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * MINUTE_MS],
  ["month", 30 * 24 * 60 * MINUTE_MS],
  ["week", 7 * 24 * 60 * MINUTE_MS],
  ["day", 24 * 60 * MINUTE_MS],
  ["hour", 60 * MINUTE_MS],
  ["minute", MINUTE_MS],
];

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const relativeTime = (from: number, now: number): string => {
  const diff = Math.max(0, now - from);
  if (diff < MINUTE_MS) return "just now";
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (diff >= unitMs) return relativeTimeFormat.format(-Math.round(diff / unitMs), unit);
  }
  return relativeTimeFormat.format(-Math.round(diff / MINUTE_MS), "minute");
};

export const lastOpenedLabel = (lastOpened: number, now: number): string =>
  lastOpened ? relativeTime(lastOpened, now) : "not opened yet";

export function Landing() {
  const [, navigate] = useLocation();
  const [recents, setRecents] = useState<RecentBoard[]>(() => loadRecents(localStorage));

  const createBoard = () => navigate(`/b/${randomBoardId()}`);

  const editName = (id: string, name: string) => {
    setRecents((current) => renameRecent(current, id, name));
  };

  const commitNames = () => {
    setRecents((current) => {
      saveRecents(localStorage, current);
      return current;
    });
  };

  const remove = (id: string) => {
    setRecents((current) => {
      const next = removeRecent(current, id);
      saveRecents(localStorage, next);
      return next;
    });
  };

  return (
    <main class="landing">
      <header class="landing-header">
        <h1>Stallion</h1>
        <button type="button" class="new-board" onClick={createBoard}>
          New board
        </button>
      </header>
      {recents.length > 0 && (
        <ul class="recents">
          {recents.map((recent) => (
            <li key={recent.id} class="recent">
              <button
                type="button"
                class="recent-open"
                onClick={() => navigate(`/b/${recent.id}`)}
                aria-label={`Open board ${recent.name}`}
              >
                {recent.thumbnail ? (
                  <img class="recent-thumb" src={recent.thumbnail} alt="" />
                ) : (
                  <span class="recent-thumb recent-thumb-empty" aria-hidden="true" />
                )}
                <span class="recent-time">{lastOpenedLabel(recent.lastOpened, Date.now())}</span>
              </button>
              <input
                class="recent-name"
                value={recent.name}
                aria-label={`Name for board ${recent.id}`}
                onInput={(event) => editName(recent.id, event.currentTarget.value)}
                onBlur={commitNames}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <button
                type="button"
                class="recent-remove"
                aria-label={`Forget board ${recent.name}`}
                title="Remove from this device's recent boards"
                onClick={() => remove(recent.id)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
