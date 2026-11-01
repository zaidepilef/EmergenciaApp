"use client";

import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const env = readPublicEnv();
    browserClient = createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }

  return browserClient;
}
