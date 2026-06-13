import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";

export function getServerSupabase(accessToken?: string) {
  if (!isSupabaseConfigured()) return null;
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
