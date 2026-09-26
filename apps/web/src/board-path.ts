export const MAX_SLUG_LENGTH = 60;

export const boardSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");

export const boardPath = (boardId: string, name: string): string => {
  const base = `/b/${encodeURIComponent(boardId)}`;
  const slug = name === boardId ? "" : boardSlug(name);
  return slug ? `${base}/${slug}` : base;
};

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const BOARD_PATH = /^\/b\/([^/]+)(?:\/[^/]*)?\/?$/;

export const boardIdFromPath = (pathname: string): string | undefined => {
  const match = BOARD_PATH.exec(pathname);
  return match?.[1] ? decodeSegment(match[1]) : undefined;
};
