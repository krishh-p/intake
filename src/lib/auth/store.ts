import type { AuthSession, AuthUser, StoredUser } from "@/lib/auth/types";

const USERS_KEY = "intake_users";
const SESSION_KEY = "intake_session";

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(): string {
  return crypto.randomUUID();
}

function getUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]") as StoredUser[];
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  dob: string;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.name.trim() || !input.dob) {
    throw new Error("All fields are required.");
  }
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const users = getUsers();
  if (users.some((u) => u.email === email)) {
    throw new Error("An account with this email already exists.");
  }

  const user: StoredUser = {
    id: crypto.randomUUID(),
    email,
    name: input.name.trim(),
    dob: input.dob,
    passwordHash: await hashPassword(input.password),
  };

  users.push(user);
  saveUsers(users);
  return { id: user.id, email: user.email, name: user.name, dob: user.dob };
}

export async function loginUser(
  email: string,
  password: string
): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const user = getUsers().find((u) => u.email === normalized);
  if (!user) throw new Error("Invalid email or password.");

  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) throw new Error("Invalid email or password.");

  return { id: user.id, email: user.email, name: user.name, dob: user.dob };
}

export function createSession(userId: string): AuthSession {
  const session: AuthSession = {
    userId,
    token: generateToken(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (new Date(session.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getUserById(userId: string): AuthUser | null {
  const user = getUsers().find((u) => u.id === userId);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, dob: user.dob };
}

export function workspaceKey(userId: string) {
  return `intake_workspace_${userId}`;
}
