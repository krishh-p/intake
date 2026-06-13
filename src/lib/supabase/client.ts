"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import { logSupabaseError } from "@/lib/supabase/errors";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    const { url, publishableKey } = getSupabaseConfig();
    browserClient = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

export async function getAuthenticatedSupabase() {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    logSupabaseError("getUser", error);
    return null;
  }
  if (!user) return null;

  return { supabase, userId: user.id };
}
