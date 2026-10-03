import { createClient } from "@supabase/supabase-js";
import type { Database } from "./accountTypes";

const url = import.meta.env["VITE_SUPABASE_URL"];
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
export const accountsConfigured = Boolean(url && key);
let client: ReturnType<typeof createClient<Database>> | undefined;

// Lazy so an unconfigured build still plays normally and SSR never reads storage.
export const accountClient = new Proxy({} as ReturnType<typeof createClient<Database>>, {
  get(_, prop) {
    if (!accountsConfigured) throw new Error("Accounts are unavailable right now.");
    client ??= createClient<Database>(url, key, {
      global: {
        fetch: (input, init) => {
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          if (init?.headers)
            new Headers(init.headers).forEach((value, name) => headers.set(name, value));
          // Publishable keys are opaque API keys, not user bearer JWTs.
          if (
            key.startsWith("sb_publishable_") &&
            headers.get("Authorization") === `Bearer ${key}`
          ) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return Reflect.get(client, prop, client);
  },
});
