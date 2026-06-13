/**
 * Supabase/PostgREST failures are logged here and kept out of the UI.
 * Local workspace state is the source of truth; cloud sync is best-effort.
 */
export function logSupabaseError(scope: string, error: unknown): void {
  if (!error) return;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  console.warn(`[supabase:${scope}]`, code ? `${code}: ${message}` : message);
}

/** Auth API messages are usually safe; strip noisy provider prefixes. */
export function authErrorMessage(error: { message?: string }): string {
  const raw = error.message?.trim() ?? "Something went wrong";
  if (raw === "Invalid login credentials") return "Invalid email or password.";
  if (raw === "Email not confirmed") return "Confirm your email before signing in.";
  return raw;
}
