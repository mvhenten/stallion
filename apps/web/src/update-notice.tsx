import { useRegisterSW } from "virtual:pwa-register/preact";

export function UpdateNotice() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div class="notice" role="status">
      <p>Update available.</p>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}
