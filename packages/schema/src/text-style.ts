export const TEXT_FONTS = ["Sans", "Serif", "Mono", "Hand"] as const;

export type TextFont = (typeof TEXT_FONTS)[number];

export const DEFAULT_TEXT_FONT: TextFont = "Sans";

export const TEXT_FITS = ["Fixed", "Auto"] as const;

export type TextFit = (typeof TEXT_FITS)[number];

export const DEFAULT_TEXT_FIT: TextFit = "Fixed";

export const MAX_HREF_BYTES = 2048;

// ASCII only, so the length cap counts bytes; crates/server/src/object.rs checks the same shape.
export const HREF_PATTERN =
  "^[Hh][Tt][Tt][Pp][Ss]?://([A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.?|\\[[0-9A-Fa-f:.]+\\])(:[0-9]{1,5})?([/?#][!-~]*)?$";

const HREF = new RegExp(HREF_PATTERN);

export const isHref = (value: string): boolean =>
  value.length <= MAX_HREF_BYTES && HREF.test(value);

export const parseHref = (input: string): string | undefined => {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return undefined;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.hostname.includes(".") && !url.hostname.startsWith("[") && url.hostname !== "localhost")
    return undefined;
  return isHref(url.href) ? url.href : undefined;
};

export type TextStyle = {
  font: TextFont;
  bold: boolean;
  italic: boolean;
  fit: TextFit;
};

export type Styleable = {
  font?: TextFont | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  fit?: TextFit | undefined;
};

export const textStyleOf = (object: Styleable): TextStyle => ({
  font: object.font ?? DEFAULT_TEXT_FONT,
  bold: object.bold ?? false,
  italic: object.italic ?? false,
  fit: object.fit ?? DEFAULT_TEXT_FIT,
});

export const withTextStyle = <T extends Styleable>(object: T): T & TextStyle => ({
  ...object,
  ...textStyleOf(object),
});
