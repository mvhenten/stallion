export const ID_LENGTH = 25;

export const ID_BYTES = 16;

export const randomBoardId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value.toString(36).padStart(ID_LENGTH, "0");
};
