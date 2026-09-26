export const DEFAULT_BOARD = "default";

export type RecentBoard = {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail: string;
};

export const RECENTS_KEY = "stallion:recents";

export const MAX_RECENTS = 50;

type RecentsStorage = Pick<Storage, "getItem" | "setItem">;

const isRecentBoard = (value: unknown): value is RecentBoard => {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, lastOpened, thumbnail } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    typeof lastOpened === "number" &&
    typeof thumbnail === "string"
  );
};

const seedDefault = (): RecentBoard[] => [
  { id: DEFAULT_BOARD, name: DEFAULT_BOARD, lastOpened: 0, thumbnail: "" },
];

export const loadRecents = (storage: RecentsStorage): RecentBoard[] => {
  const raw = storage.getItem(RECENTS_KEY);
  if (raw === null) return seedDefault();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentBoard) : [];
  } catch {
    return [];
  }
};

export const saveRecents = (storage: RecentsStorage, recents: readonly RecentBoard[]): void => {
  try {
    storage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // Recents are a per-device convenience; losing a write only forgets recency.
  }
};

const sortByRecency = (recents: readonly RecentBoard[]): RecentBoard[] =>
  [...recents].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, MAX_RECENTS);

export type RecentPatch = { id: string } & Partial<Omit<RecentBoard, "id">>;

export const upsertRecent = (
  recents: readonly RecentBoard[],
  patch: RecentPatch,
): RecentBoard[] => {
  const existing = recents.find((recent) => recent.id === patch.id);
  const merged: RecentBoard = {
    id: patch.id,
    name: patch.name ?? existing?.name ?? patch.id,
    lastOpened: patch.lastOpened ?? Date.now(),
    thumbnail: patch.thumbnail ?? existing?.thumbnail ?? "",
  };
  const rest = recents.filter((recent) => recent.id !== patch.id);
  return sortByRecency([merged, ...rest]);
};

export const removeRecent = (recents: readonly RecentBoard[], id: string): RecentBoard[] =>
  recents.filter((recent) => recent.id !== id);

export const renameRecent = (
  recents: readonly RecentBoard[],
  id: string,
  name: string,
): RecentBoard[] => recents.map((recent) => (recent.id === id ? { ...recent, name } : recent));
