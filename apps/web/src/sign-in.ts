const REDIRECT_KEY = "stallion:sign-in-redirect";

export type SignInStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SignInRedirect = {
  redirectOnce(): boolean;
  signedIn(): void;
};

export const signInPath = (here: Pick<Location, "pathname" | "search">): string =>
  `/sign-in?to=${encodeURIComponent(here.pathname + here.search)}`;

export const returnPath = (search: string, origin: string): string => {
  const to = new URLSearchParams(search).get("to");
  if (!to?.startsWith("/")) return "/";
  const url = new URL(to, origin);
  if (url.origin !== origin || url.pathname === "/sign-in") return "/";
  return url.pathname + url.search;
};

export function signInRedirect(storage: SignInStorage, navigate: () => void): SignInRedirect {
  return {
    redirectOnce() {
      if (storage.getItem(REDIRECT_KEY) !== null) return false;
      storage.setItem(REDIRECT_KEY, "1");
      navigate();
      return true;
    },
    signedIn() {
      storage.removeItem(REDIRECT_KEY);
    },
  };
}

export const goToSignIn = (): void => location.assign(signInPath(location));

export const pageSignIn = (): SignInRedirect => signInRedirect(sessionStorage, goToSignIn);
