import { expect, test } from "vitest";
import { fitColumns, maxColumns, paletteRoom } from "./palette-fit";

const PALETTE_HEIGHTS: Record<number, number> = { 2: 1180, 3: 876, 4: 828, 5: 700, 6: 620, 7: 620 };
const heightAt = (columns: number) => PALETTE_HEIGHTS[columns] ?? 600;

test("adds columns until the palette fits a laptop viewport", () => {
  expect(fitColumns(heightAt, paletteRoom(789, 12, []), 12)).toBe(5);
  expect(fitColumns(heightAt, paletteRoom(823, 12, []), 12)).toBe(5);
  expect(fitColumns(heightAt, paletteRoom(1000, 12, []), 12)).toBe(3);
});

test("keeps two columns when the viewport is tall enough", () => {
  expect(fitColumns(heightAt, paletteRoom(1400, 12, []), 12)).toBe(2);
});

test("stops above a visible notice", () => {
  expect(paletteRoom(1000, 12, [920])).toBe(900);
  expect(fitColumns(heightAt, paletteRoom(1000, 12, [880]), 12)).toBe(4);
});

test("never grows wider than the viewport allows", () => {
  expect(maxColumns(412)).toBe(7);
  expect(fitColumns((columns) => 5000 - columns, 100, maxColumns(412))).toBe(7);
  expect(maxColumns(100)).toBe(2);
});

test("stops adding columns once the palette gets no shorter", () => {
  expect(fitColumns(heightAt, 500, 12)).toBe(6);
});
