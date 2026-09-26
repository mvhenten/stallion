import type { MyBoards } from "@stallion/client-sync";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation } from "wouter-preact";
import { randomBoardId } from "./id";
import { myBoardsForPage, syncBoards } from "./my-boards";
import { loadRecents, type RecentBoard, removeRecent, renameRecent, saveRecents } from "./recents";
import { reportLink } from "./report";

type Remote =
  | { state: "LocalOnly" }
  | { state: "Syncing" }
  | { state: "Synced" }
  | { state: "Offline" }
  | { state: "SignedOut"; message: string }
  | { state: "Failed"; message: string };

const remoteAfter = (reason: string, message: string): Remote => {
  if (reason === "NetworkError" && globalThis.navigator?.onLine === false) {
    return { state: "Offline" };
  }
  if (reason === "Http401" || reason === "Http403") return { state: "SignedOut", message };
  return { state: "Failed", message: `Could not sync your boards: ${message}` };
};

function RemoteNotice({ remote }: { remote: Remote }) {
  if (remote.state === "Offline") {
    return (
      <p class="landing-status" role="status">
        Offline: showing the boards on this device. They sync when you are back online.
      </p>
    );
  }
  if (remote.state === "SignedOut") {
    return (
      <div class="landing-alert" role="alert">
        <p>Your sign-in has expired, so your boards from other devices are missing.</p>
        <button type="button" class="action" onClick={() => window.location.reload()}>
          Sign in again
        </button>
      </div>
    );
  }
  if (remote.state === "Failed") {
    return (
      <div class="landing-alert" role="alert">
        <p>{remote.message}. Showing the boards on this device.</p>
        <a href={reportLink(remote.message)} target="_blank" rel="noreferrer">
          Report an issue
        </a>
      </div>
    );
  }
  return null;
}

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
  const api = useMemo<MyBoards | undefined>(myBoardsForPage, []);
  const [remote, setRemote] = useState<Remote>(() =>
    api ? { state: "Syncing" } : { state: "LocalOnly" },
  );
  const recentsRef = useRef(recents);
  recentsRef.current = recents;

  useEffect(() => {
    if (!api) return;
    let live = true;
    syncBoards(api, loadRecents(localStorage)).then((synced) => {
      if (!live) return;
      saveRecents(localStorage, synced.boards);
      setRecents(synced.boards);
      setRemote(
        synced.state === "Synced"
          ? { state: "Synced" }
          : remoteAfter(synced.reason, synced.message),
      );
    });
    return () => {
      live = false;
    };
  }, [api]);

  const createBoard = () => navigate(`/b/${randomBoardId()}`);

  const editName = (id: string, name: string) => {
    setRecents((current) => renameRecent(current, id, name));
  };

  const commitName = (id: string) => {
    const current = recentsRef.current;
    saveRecents(localStorage, current);
    const board = current.find((recent) => recent.id === id);
    if (!api || !board || board.renamedAt === 0) return;
    const { renamedAt } = board;
    api.upsert(id, { name: board.name }).then((result) => {
      if (!result.ok) {
        setRemote(remoteAfter(result.reason, result.message));
        return;
      }
      setRecents((latest) => {
        const next = latest.map((recent) =>
          recent.id === id && recent.renamedAt === renamedAt ? { ...recent, renamedAt: 0 } : recent,
        );
        saveRecents(localStorage, next);
        return next;
      });
    });
  };

  const remove = (id: string) => {
    setRecents((current) => {
      const next = removeRecent(current, id);
      saveRecents(localStorage, next);
      return next;
    });
    api?.remove(id).then((result) => {
      if (!result.ok) setRemote(remoteAfter(result.reason, result.message));
    });
  };

  return (
    <main class="landing" data-sync={remote.state}>
      <header class="landing-header">
        <h1>Stallion</h1>
        <button type="button" class="new-board" onClick={createBoard}>
          New board
        </button>
      </header>
      <RemoteNotice remote={remote} />
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
                onBlur={() => commitName(recent.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <button
                type="button"
                class="recent-remove"
                aria-label={`Forget board ${recent.name}`}
                title={api ? "Remove from your boards" : "Remove from this device's recent boards"}
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
