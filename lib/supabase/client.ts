"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (client) return client;

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://oyjirtozeoeeacogldpx.supabase.co";

  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!key && typeof window !== "undefined") {
    console.error(
      "Supabase public API key is missing. Set NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel as a 'Config' variable."
    );
  }

  client = createBrowserClient(url, key);
  return client;
}