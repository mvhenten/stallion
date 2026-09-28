export const MAX_STICKY_BYTES = 4096;

const utf8 = new TextEncoder();

export const utf8Length = (text: string): number => utf8.encode(text).length;

export const clampUtf8 = (text: string, max = MAX_STICKY_BYTES): string => {
  if (utf8Length(text) <= max) return text;
  let kept = "";
  let bytes = 0;
  for (const char of text) {
    const size = utf8Length(char);
    if (bytes + size > max) break;
    kept += char;
    bytes += size;
  }
  return kept;
};
