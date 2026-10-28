const REDIRECT_KEY = "stallion:sign-in-redirect";

export type SignInStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SignInRedirect = {
  expired(): boolean;
  signedIn(): void;
};

export function signInRedirect(storage: () => SignInStorage, navigate: () => void): SignInRedirect {
  const claim = (): boolean => {
    try {
      const store = storage();
      if (store.getItem(REDIRECT_KEY) !== null) return false;
      store.setItem(REDIRECT_KEY, "1");
      return true;
    } catch {
      return false;
    }
  };
  return {
    expired() {
      if (!claim()) return false;
      navigate();
      return true;
    },
    signedIn() {
      try {
        storage().removeItem(REDIRECT_KEY);
      } catch {}
    },
  };
}

export const signIn: SignInRedirect = signInRedirect(
  () => sessionStorage,
  () => location.assign(location.href),
);
