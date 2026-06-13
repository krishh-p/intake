"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  if (authLoading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await register({ email, password, name, dob });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[45%] flex-col justify-between border-r border-line bg-surface p-14 lg:flex">
        <p className="font-display text-xl text-ink">Intake</p>
        <div>
          <h1 className="font-display text-[2rem] leading-snug tracking-tight text-ink">
            Your health story,
            <br />
            organized before the appointment.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-muted">
            Import records, capture context, and walk into every visit with a clear,
            evidence-backed picture of your health.
          </p>
        </div>
        <p className="text-[11px] uppercase tracking-widest text-ink-faint">
          Private · Patient-owned · Not a diagnosis
        </p>
      </div>

      <div className="flex w-full flex-col justify-center px-8 py-14 lg:w-[55%] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <p className="font-display text-xl text-ink lg:hidden">Intake</p>

          <div className="mt-8 flex border-b border-line">
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={cn(
                  "flex-1 border-b-2 pb-2.5 text-sm font-medium transition",
                  mode === m
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-faint hover:text-ink-muted"
                )}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <h2 className="mt-8 font-display text-xl text-ink">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "register" && (
              <>
                <label className="block">
                  <FieldLabel>Full name</FieldLabel>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label className="block">
                  <FieldLabel>Date of birth</FieldLabel>
                  <Input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            <label className="block">
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <FieldLabel>Password</FieldLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            {error && <p className="text-sm text-alert-high">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full py-2.5">
              {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
