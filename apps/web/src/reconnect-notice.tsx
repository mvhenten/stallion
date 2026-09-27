import type { NoticeState } from "./reconnect";

type ReconnectNoticeProps = {
  notice: NoticeState;
  reconnectMessage: string;
};

export function ReconnectNotice({ notice, reconnectMessage }: ReconnectNoticeProps) {
  if (notice === "Expired") {
    return (
      <div class="notice" role="alert">
        <p>Your sign-in expired.</p>
        <button type="button" class="action" onClick={() => location.assign(location.href)}>
          Sign in again
        </button>
      </div>
    );
  }
  if (notice === "Reconnecting") {
    return (
      <div class="notice" role="alert">
        <p>{reconnectMessage}</p>
        <button type="button" class="action" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  return null;
}
