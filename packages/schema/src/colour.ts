export const PALETTE_RGB = [0x1f2328, 0xe5484d, 0xf76b15, 0x30a46c, 0x0090ff, 0x8e4ec6] as const;

export const MAX_RGB = 0xffffff;

export type Coloured = { colour: number; rgb?: number | undefined };

export const rgbOf = ({ colour, rgb }: Coloured): number =>
  rgb ?? PALETTE_RGB[colour] ?? PALETTE_RGB[0];

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 0xff,
  (rgb >> 8) & 0xff,
  rgb & 0xff,
];

export const nearestColour = (rgb: number): number => {
  const [r, g, b] = channels(rgb);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  PALETTE_RGB.forEach((entry, index) => {
    const [er, eg, eb] = channels(entry);
    const distance = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
};

export const rgbHex = (rgb: number): string => `#${rgb.toString(16).padStart(6, "0")}`;

export const parseRgbHex = (text: string): number | undefined => {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim());
  if (!match?.[1]) return undefined;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  return Number.parseInt(digits, 16);
};

export const withRgb = <T extends Coloured>(object: T): T & { rgb: number } => ({
  ...object,
  rgb: rgbOf(object),
});
