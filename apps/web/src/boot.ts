import { errorMessage, reportLink } from "./report";

export type AppModule<Root> = { mount(root: Root): void };

export const bootFailureMessage = (error: unknown): string =>
  `The drawing board could not start: ${errorMessage(error)}`;

export const boot = <Root>(
  root: Root,
  load: () => Promise<AppModule<Root>>,
  onFailure: (message: string) => void,
): Promise<void> =>
  load()
    .then((app) => app.mount(root))
    .catch((error: unknown) => onFailure(bootFailureMessage(error)));

export const showBootFailure = (root: HTMLElement, message: string): void => {
  const panel = document.createElement("div");
  panel.setAttribute("role", "alert");
  panel.style.cssText =
    "margin:16px;padding:12px 16px;border:1px solid #e5484d;border-radius:10px;background:#fff5f5;color:#8a1c1f;font-family:system-ui,sans-serif";
  const text = document.createElement("p");
  text.style.margin = "0 0 8px";
  text.textContent = `${message}. Reload to try again.`;
  const link = document.createElement("a");
  link.href = reportLink(message);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Report an issue";
  panel.append(text, link);
  root.replaceChildren(panel);
};
