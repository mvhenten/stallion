import type { BoardLock, PinResult } from "@stallion/client-sync";
import { useState } from "preact/hooks";
import { PIN_PATTERN } from "./share";

type PinPromptProps = {
  lock: BoardLock | undefined;
  onJoin: (pin: string) => Promise<PinResult>;
};

export const lockMessage = (lock: BoardLock | undefined): string =>
  lock?.reason === "PassInvalid"
    ? `Your access to this board ended (${lock.message}). Enter the PIN to join again.`
    : "This board is locked. Enter its PIN to join.";

export function PinPrompt({ lock, onJoin }: PinPromptProps) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const submit = async () => {
    if (!PIN_PATTERN.test(pin)) return;
    setBusy(true);
    setFailure(undefined);
    const result = await onJoin(pin);
    setBusy(false);
    if (result.ok) return;
    setPin("");
    setFailure(`Could not join: ${result.message}`);
  };

  return (
    <form
      class="notice pin-prompt"
      aria-label="Board PIN"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p>{lockMessage(lock)}</p>
      <div class="pin-row">
        <input
          class="field pin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{6}"
          maxLength={6}
          placeholder="6 digits"
          aria-label="Board PIN"
          value={pin}
          onInput={(event) => setPin(event.currentTarget.value.replace(/\D/g, ""))}
        />
        <button type="submit" class="action" disabled={busy || !PIN_PATTERN.test(pin)}>
          Join
        </button>
      </div>
      {failure && (
        <p class="pin-failure" role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}
