import { useEffect, useRef, useState } from "preact/hooks";
import QRCode from "qrcode";
import { boardPath } from "./board-path";
import { errorMessage } from "./report";
import type { BoardSource } from "./sync";

export const PIN_PATTERN = /^\d{6}$/;

export const boardLink = (origin: string, boardId: string, name: string): string =>
  `${origin}${boardPath(boardId, name)}`;

type PinSource = Pick<BoardSource, "pinState" | "setPin">;

type ShareProps = {
  link: string;
  name: string;
  onRename: (name: string) => void;
  source: PinSource | undefined;
  onClose: () => void;
};

type PinView =
  | { state: "Checking" }
  | { state: "Known"; pinSet: boolean }
  | { state: "Failed"; message: string };

export const copyText = async (text: string, input: HTMLInputElement | null): Promise<string> => {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    const copied = await clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (copied) return "Link copied.";
  }
  input?.focus();
  input?.select();
  if (document.execCommand?.("copy")) return "Link copied.";
  return "Link selected: copy it from the field.";
};

export function SharePanel({ link, name, onRename, source, onClose }: ShareProps) {
  const [nameDraft, setNameDraft] = useState(name);
  const [qr, setQr] = useState<string | undefined>(undefined);
  const [qrError, setQrError] = useState<string | undefined>(undefined);
  const [pin, setPin] = useState<PinView>({ state: "Checking" });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | undefined>(undefined);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const linkRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(
      (svg) => live && setQr(svg),
      (error: unknown) => live && setQrError(`Could not draw the QR code: ${errorMessage(error)}`),
    );
    return () => {
      live = false;
    };
  }, [link]);

  useEffect(() => {
    if (!source) {
      setPin({ state: "Failed", message: "the board is not open" });
      return;
    }
    let live = true;
    source.pinState().then((state) => {
      if (!live) return;
      setPin(
        state.ok
          ? { state: "Known", pinSet: state.pinSet }
          : { state: "Failed", message: state.message },
      );
    });
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-share-toggle]")) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onEscape);
    };
  }, [onClose]);

  const apply = async (next: string) => {
    if (!source) return;
    setBusy(true);
    setResult(undefined);
    const outcome = await source.setPin(next);
    setBusy(false);
    if (!outcome.ok) {
      setResult({ ok: false, message: `Could not update the PIN: ${outcome.message}` });
      return;
    }
    setPin({ state: "Known", pinSet: outcome.pinSet });
    setDraft("");
    setResult({
      ok: true,
      message: outcome.pinSet ? "PIN set." : "PIN removed: anyone with the link can join.",
    });
  };

  const pinSet = pin.state === "Known" && pin.pinSet;

  return (
    <div class="share" role="dialog" aria-label="Share this board" ref={rootRef}>
      <h2>Share this board</h2>
      <input
        class="field share-name"
        type="text"
        value={nameDraft}
        aria-label="Board name"
        placeholder="Board name"
        onInput={(event) => setNameDraft(event.currentTarget.value)}
        onBlur={() => {
          if (nameDraft !== name) onRename(nameDraft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <div class="share-link">
        <input
          ref={linkRef}
          class="field"
          type="text"
          readOnly
          value={link}
          aria-label="Board link"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class="action"
          onClick={() => copyText(link, linkRef.current).then(setCopied)}
        >
          Copy link
        </button>
      </div>
      {copied && (
        <p class="share-note" role="status">
          {copied}
        </p>
      )}
      <div class="share-qr" aria-label="QR code of the board link" role="img">
        {qr ? (
          <div class="qr" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <p class="share-note">{qrError ?? "Drawing the QR code…"}</p>
        )}
      </div>
      <p class="share-pin" data-pin-state={pin.state === "Known" ? String(pin.pinSet) : pin.state}>
        {pin.state === "Checking" && "Checking the PIN…"}
        {pin.state === "Failed" && `Could not read the PIN state: ${pin.message}`}
        {pin.state === "Known" &&
          (pin.pinSet
            ? "PIN set: people with the link need the PIN to join."
            : "No PIN: anyone with the link can join.")}
      </p>
      <form
        class="share-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (PIN_PATTERN.test(draft)) apply(draft);
        }}
      >
        <input
          class="field pin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{6}"
          maxLength={6}
          placeholder="6 digits"
          aria-label={pinSet ? "New PIN" : "PIN"}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value.replace(/\D/g, ""))}
        />
        <button type="submit" class="action" disabled={busy || !PIN_PATTERN.test(draft)}>
          {pinSet ? "Change PIN" : "Set PIN"}
        </button>
        {pinSet && (
          <button type="button" class="action quiet" disabled={busy} onClick={() => apply("")}>
            Remove PIN
          </button>
        )}
      </form>
      {result && (
        <p
          class={result.ok ? "share-note" : "share-note failed"}
          role={result.ok ? "status" : "alert"}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
