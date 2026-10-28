import { useEffect, useRef, useState } from "preact/hooks";
import type { Connection } from "./sync";

export const RECONNECT_NOTICE_MS = 10_000;

export type NoticeState = "None" | "Reconnecting" | "Expired";

export type ConnectionNoticeController = {
  onConnection(connection: Connection): void;
  stop(): void;
};

const isStale = (connection: Connection): boolean =>
  connection === "Reconnecting" || connection === "Offline";

export function createConnectionNotice(
  setNotice: (notice: NoticeState) => void,
  checkExpired?: () => Promise<boolean>,
): ConnectionNoticeController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;

  const clear = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    onConnection(connection) {
      if (!isStale(connection)) {
        clear();
        setNotice("None");
        return;
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        setNotice("Reconnecting");
        checkExpired?.().then((expired) => {
          if (live && expired) setNotice("Expired");
        });
      }, RECONNECT_NOTICE_MS);
    },
    stop() {
      live = false;
      clear();
    },
  };
}

export function useConnectionNotice(
  connection: Connection,
  checkExpired?: () => Promise<boolean>,
): NoticeState {
  const [notice, setNotice] = useState<NoticeState>("None");
  const checkRef = useRef(checkExpired);
  checkRef.current = checkExpired;
  const controllerRef = useRef<ConnectionNoticeController | undefined>(undefined);
  if (!controllerRef.current) {
    controllerRef.current = createConnectionNotice(
      setNotice,
      checkRef.current ? () => checkRef.current?.() ?? Promise.resolve(false) : undefined,
    );
  }

  useEffect(() => {
    controllerRef.current?.onConnection(connection);
  }, [connection]);

  useEffect(() => () => controllerRef.current?.stop(), []);

  return notice;
}
