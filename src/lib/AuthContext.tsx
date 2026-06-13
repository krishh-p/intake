"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@/lib/auth/types";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { authErrorMessage, logSupabaseError } from "@/lib/supabase/errors";
import {
  clearSession,
  createSession,
  getSession,
  getUserById,
  loginUser,
  registerUser,
} from "@/lib/auth/store";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    dob: string;
  }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function authUserFromSupabase(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    name:
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : "Patient",
    dob:
      typeof user.user_metadata?.dob === "string" ? user.user_metadata.dob : "",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const supabase = getBrowserSupabase();

    async function hydrate() {
      if (supabase) {
        const {
          data: { user: supabaseUser },
        } = await supabase.auth.getUser();
        if (!active) return;
        setUser(supabaseUser ? authUserFromSupabase(supabaseUser) : null);
        setLoading(false);
        return;
      }

      const session = getSession();
      const found = session ? getUserById(session.userId) : null;
      if (!active) return;
      setUser(found);
      setLoading(false);
    }

    hydrate();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? authUserFromSupabase(session.user) : null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const supabase = getBrowserSupabase();
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(authErrorMessage(error));
      if (data.user) setUser(authUserFromSupabase(data.user));
      return;
    }

    const authUser = await loginUser(email, password);
    createSession(authUser.id);
    setUser(authUser);
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      name: string;
      dob: string;
    }) => {
      const supabase = getBrowserSupabase();
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: {
              name: input.name.trim(),
              dob: input.dob,
            },
          },
        });
        if (error) throw new Error(authErrorMessage(error));
        const supabaseUser = data.user;
        if (!supabaseUser) {
          throw new Error("Check your email to finish creating your account.");
        }

        const { error: profileError } = await supabase.from("profiles").upsert({
          id: supabaseUser.id,
          email: supabaseUser.email,
          name: input.name.trim(),
          dob: input.dob,
        });
        if (profileError) logSupabaseError("profiles:upsert", profileError);
        setUser(authUserFromSupabase(supabaseUser));
        return;
      }

      const authUser = await registerUser(input);
      createSession(authUser.id);
      setUser(authUser);
    },
    [],
  );

  const logout = useCallback(() => {
    const supabase = getBrowserSupabase();
    if (supabase) {
      void supabase.auth.signOut();
    }
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
