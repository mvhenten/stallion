const ISSUE_URL = "https://github.com/mvhenten/stallion/issues/new";

export const reportLink = (message: string): string =>
  `${ISSUE_URL}?${new URLSearchParams({
    title: "Drawing board error",
    body: `${message}\n\nBrowser: ${navigator.userAgent}`,
  })}`;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
