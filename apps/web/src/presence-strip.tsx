import { useEffect, useRef, useState } from "preact/hooks";
import type { Peer, Presence } from "./presence";

export const MAX_CHIPS = 5;

type PresenceStripProps = {
  presence: Presence;
  onFollow: (clientId: number | undefined) => void;
};

const initial = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

const chipTitle = (peer: Peer, following: boolean): string => {
  if (peer.self) return "You";
  return following ? `Following ${peer.name}, tap to stop` : `${peer.name}, tap to follow`;
};

function PeerChip({
  peer,
  following,
  onFollow,
}: {
  peer: Peer;
  following: boolean;
  onFollow: (clientId: number | undefined) => void;
}) {
  return (
    <button
      type="button"
      class="peer"
      data-peer={peer.clientId}
      aria-pressed={following}
      aria-label={chipTitle(peer, following)}
      title={chipTitle(peer, following)}
      disabled={peer.self}
      style={{ background: peer.colour }}
      onClick={() => onFollow(following ? undefined : peer.clientId)}
    >
      {initial(peer.name)}
    </button>
  );
}

export function PresenceStrip({ presence, onFollow }: PresenceStripProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const { peers, following } = presence;
  const shown = peers.length > MAX_CHIPS ? peers.slice(0, MAX_CHIPS - 1) : peers;
  const hidden = peers.slice(shown.length);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (peers.length === 0) return null;

  return (
    <fieldset class="presence" ref={rootRef} aria-label="People on this board">
      {shown.map((peer) => (
        <PeerChip
          key={peer.clientId}
          peer={peer}
          following={peer.clientId === following}
          onFollow={onFollow}
        />
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          class="peer more"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${hidden.length} more people`}
          title={`${hidden.length} more people`}
          onClick={() => setOpen(!open)}
        >
          +{hidden.length}
        </button>
      )}
      {open && (
        <div class="peer-list" role="listbox" aria-label="More people">
          {hidden.map((peer) => (
            <button
              key={peer.clientId}
              type="button"
              role="option"
              class="peer-option"
              aria-selected={peer.clientId === following}
              disabled={peer.self}
              onClick={() => {
                setOpen(false);
                onFollow(peer.clientId === following ? undefined : peer.clientId);
              }}
            >
              <span class="peer small" style={{ background: peer.colour }} aria-hidden="true">
                {initial(peer.name)}
              </span>
              <span>{peer.name}</span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function FollowPill({ presence, onStop }: { presence: Presence; onStop: () => void }) {
  const target = presence.peers.find((peer) => peer.clientId === presence.following);
  if (!target) return null;
  return (
    <button type="button" class="follow-pill" onClick={onStop}>
      <span class="peer small" style={{ background: target.colour }} aria-hidden="true">
        {initial(target.name)}
      </span>
      Following {target.name}, tap to stop
    </button>
  );
}
