import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";

export const MIN_COLUMNS = 2;
export const PALETTE_GUTTER = 16;
export const NOTICE_GAP = 8;
const COLUMN_PITCH = 48;
const PALETTE_CHROME = 14;

export const maxColumns = (viewportWidth: number): number =>
  Math.max(
    MIN_COLUMNS,
    Math.floor((viewportWidth - 2 * PALETTE_GUTTER - PALETTE_CHROME + 4) / COLUMN_PITCH),
  );

export const paletteRoom = (
  viewportHeight: number,
  top: number,
  noticeTops: readonly number[],
): number =>
  Math.min(viewportHeight - PALETTE_GUTTER, ...noticeTops.map((t) => t - NOTICE_GAP)) - top;

export const fitColumns = (
  heightAt: (columns: number) => number,
  room: number,
  most: number,
): number => {
  let previous = Number.POSITIVE_INFINITY;
  for (let columns = MIN_COLUMNS; columns <= most; columns++) {
    const height = heightAt(columns);
    if (height <= room) return columns;
    if (height >= previous) return columns - 1;
    previous = height;
  }
  return most;
};

const noticeTops = (): number[] =>
  [...document.querySelectorAll(".notice")]
    .map((notice) => notice.getBoundingClientRect())
    .filter((rect) => rect.height > 0)
    .map((rect) => rect.top);

export const usePaletteFit = (ref: RefObject<HTMLElement>, active: boolean): void => {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || !active) return;
    let notices = "";
    const fit = () => {
      const tops = noticeTops();
      notices = tops.join();
      const room = paletteRoom(window.innerHeight, bar.getBoundingClientRect().top, tops);
      const columns = fitColumns(
        (count) => {
          bar.style.setProperty("--palette-columns", String(count));
          return bar.offsetHeight;
        },
        room,
        maxColumns(window.innerWidth),
      );
      bar.style.setProperty("--palette-columns", String(columns));
    };
    const noticesChanged = () => {
      if (noticeTops().join() !== notices) fit();
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(bar);
    const mutations = new MutationObserver(noticesChanged);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", fit);
      bar.style.removeProperty("--palette-columns");
    };
  }, [ref, active]);
};
