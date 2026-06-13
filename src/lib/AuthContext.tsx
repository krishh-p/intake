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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getSession();
    if (session) {
      const found = getUserById(session.userId);
      setUser(found);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
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
      const authUser = await registerUser(input);
      createSession(authUser.id);
      setUser(authUser);
    },
    []
  );

  const logout = useCallback(() => {
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
