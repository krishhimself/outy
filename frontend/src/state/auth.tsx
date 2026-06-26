import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, api, setAuthToken, User } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "outy.auth.token.v1";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: User; needsUsername: boolean };

type AuthCtx = {
  state: AuthState;
  user: User | null;
  token: string | null;
  signUp: (body: { email: string; password: string; name: string; username: string }) => Promise<void>;
  signIn: (body: { email: string; password: string }) => Promise<void>;
  claimUsername: (username: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setNeedsUsername: (v: boolean) => void;
  updateProfile: (body: { name?: string; avatar_url?: string | null }) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [token, setToken] = useState<string | null>(null);
  const [needsUsername, setNeedsUsernameState] = useState(false);

  const applyToken = useCallback(async (t: string | null) => {
    setToken(t);
    setAuthToken(t);
    if (t) await storage.secureSet(TOKEN_KEY, t);
    else await storage.secureRemove(TOKEN_KEY);
  }, []);

const bootstrap = useCallback(async () => {
    setState({ status: "loading" });
    const saved = await storage.secureGet<string>(TOKEN_KEY, "");
    if (!saved) {
      setState({ status: "unauthenticated" });
      return;
    }
    setToken(saved);
    setAuthToken(saved);
    try {
      const { user } = await api.me();
      setState({ status: "authenticated", user, needsUsername: false });
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.message === "Request timed out. Please try again.") {
        setAuthToken(null);
        setState({ status: "unauthenticated" });
      } else {
        await storage.secureRemove(TOKEN_KEY);
        setAuthToken(null);
        setToken(null);
        setState({ status: "unauthenticated" });
      }
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setState({ status: "authenticated", user, needsUsername });
    } catch {
      await applyToken(null);
      setState({ status: "unauthenticated" });
    }
  }, [needsUsername, applyToken]);

  const handleAuthResponse = useCallback(
    async (resp: { token: string; user: User; needs_username: boolean }) => {
      await applyToken(resp.token);
      setNeedsUsernameState(resp.needs_username);
      setState({ status: "authenticated", user: resp.user, needsUsername: resp.needs_username });
    },
    [applyToken],
  );

  const signUp = useCallback(
    async (body: { email: string; password: string; name: string; username: string }) => {
      const resp = await api.signup(body);
      await handleAuthResponse(resp);
    },
    [handleAuthResponse],
  );

  const signIn = useCallback(
    async (body: { email: string; password: string }) => {
      const resp = await api.signin(body);
      await handleAuthResponse(resp);
    },
    [handleAuthResponse],
  );

  const claimUsername = useCallback(async (username: string) => {
    const { user } = await api.claimUsername(username);
    setNeedsUsernameState(false);
    setState({ status: "authenticated", user, needsUsername: false });
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    await applyToken(null);
    setNeedsUsernameState(false);
    setState({ status: "unauthenticated" });
  }, [applyToken]);

  const updateProfile = useCallback(async (body: { name?: string; avatar_url?: string | null }) => {
    const { user } = await api.updateMe(body);
    setState({ status: "authenticated", user, needsUsername });
  }, [needsUsername]);

  const value = useMemo<AuthCtx>(() => ({
    state,
    user: state.status === "authenticated" ? state.user : null,
    token,
    signUp,
    signIn,
    claimUsername,
    signOut,
    refresh,
    setNeedsUsername: setNeedsUsernameState,
    updateProfile,
  }), [state, token, signUp, signIn, claimUsername, signOut, refresh, updateProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}

export { ApiError };

function extractFromFragment(url: string, key: string): string | null {
  const hashIdx = url.indexOf("#");
  if (hashIdx === -1) return null;
  const frag = url.slice(hashIdx + 1);
  const params = new URLSearchParams(frag);
  return params.get(key);
}