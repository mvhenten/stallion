import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PAPER = "#fbfaf7";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "icons");

const glyph = (scale) => {
  const inset = (512 * (1 - scale)) / 2;
  return `<g transform="translate(${inset} ${inset}) scale(${scale})">
    <path d="M352 150c-24-32-64-46-104-46-58 0-104 32-104 82 0 104 216 62 216 164 0 52-50 86-112 86-46 0-90-18-116-54"
      fill="none" stroke="#111111" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};

const icon = ({ radius, scale }) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${PAPER}"/>
  ${glyph(scale)}
</svg>`);

const targets = [
  { file: "icon-192.png", size: 192, radius: 96, scale: 1 },
  { file: "icon-512.png", size: 512, radius: 96, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, radius: 0, scale: 0.7 },
  { file: "apple-touch-icon.png", size: 180, radius: 0, scale: 0.9 },
];

await mkdir(OUT, { recursive: true });
for (const { file, size, radius, scale } of targets) {
  await sharp(icon({ radius, scale })).resize(size, size).png().toFile(join(OUT, file));
  console.log(`wrote ${join(OUT, file)}`);
}
