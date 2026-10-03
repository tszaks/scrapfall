// Username + password accounts (no email): the username maps to an internal sign-in address.
import type { User } from "@supabase/supabase-js";
import { followProfileSession } from "./profileSession";
import { supabase } from "@/integrations/supabase/client";

export type Profile = { id: string; username: string; color: string; kills: number; best_wave: number; matches: number };

const clean = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
const addr = (u: string) => `${clean(u)}@scrapfall.local`;

async function profileForUser(user: User): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data as Profile;
  const username = String(user.user_metadata?.["username"] ?? user.email?.split("@")[0] ?? "player");
  // Initial session and sign-in can both request the missing profile. Never reset
  // an existing row's stats/color when the requests race.
  const { error: createError } = await supabase.from("profiles").upsert(
    { id: user.id, username }, { onConflict: "id", ignoreDuplicates: true },
  );
  if (createError) throw createError;
  const { data: made, error: readError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (readError) throw readError;
  return made as Profile;
}

export function watchProfile(update: (p: Profile | null) => void, report: (error: unknown) => void, loading: (value: boolean) => void) {
  return followProfileSession<User, Profile>((callback) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, profileForUser, update, report, loading);
}

export async function signUp(username: string, password: string) {
  const name = clean(username);
  if (name.length < 3) throw new Error("Username needs 3+ letters or numbers");
  if (password.length < 6) throw new Error("Password needs 6+ characters");
  const { data, error } = await supabase.auth.signUp({ email: addr(name), password, options: { data: { username: name } } });
  if (error) throw new Error(/registered|exists/i.test(error.message) ? "That username is taken" : error.message);
  if (!data.session) throw new Error("Account created, but sign-in is incomplete. Try logging in.");
}

export async function signIn(username: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: addr(username), password });
  if (error) throw new Error("Wrong username or password");
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function saveColor(p: Profile, color: string) {
  await supabase.from("profiles").update({ color }).eq("id", p.id);
}

export async function recordRun(p: Profile, kills: number, wave: number): Promise<Profile> {
  const next = { kills: p.kills + kills, matches: p.matches + 1, best_wave: Math.max(p.best_wave, wave) };
  await supabase.from("profiles").update(next).eq("id", p.id);
  return { ...p, ...next };
}
