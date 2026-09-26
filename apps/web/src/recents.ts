export const DEFAULT_BOARD = "default";

export type RecentBoard = {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail: string;
  renamedAt: number;
};

export const RECENTS_KEY = "stallion:recents";

export const MAX_RECENTS = 200;

type RecentsStorage = Pick<Storage, "getItem" | "setItem">;

type StoredRecent = Omit<RecentBoard, "renamedAt"> & { renamedAt?: number };

const isStoredRecent = (value: unknown): value is StoredRecent => {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, lastOpened, thumbnail, renamedAt } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    typeof lastOpened === "number" &&
    typeof thumbnail === "string" &&
    (renamedAt === undefined || typeof renamedAt === "number")
  );
};

const fromStored = (stored: StoredRecent): RecentBoard => ({
  ...stored,
  renamedAt: stored.renamedAt ?? 0,
});

const seedDefault = (): RecentBoard[] => [
  { id: DEFAULT_BOARD, name: DEFAULT_BOARD, lastOpened: 0, thumbnail: "", renamedAt: 0 },
];

export const loadRecents = (storage: RecentsStorage): RecentBoard[] => {
  const raw = storage.getItem(RECENTS_KEY);
  if (raw === null) return seedDefault();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredRecent).map(fromStored) : [];
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

export const sortByRecency = (recents: readonly RecentBoard[]): RecentBoard[] =>
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
    renamedAt: patch.renamedAt ?? existing?.renamedAt ?? 0,
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
  renamedAt: number = Date.now(),
): RecentBoard[] =>
  recents.map((recent) => (recent.id === id ? { ...recent, name, renamedAt } : recent));
