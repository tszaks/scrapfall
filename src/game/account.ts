// Username + password accounts (no email): the username maps to an internal sign-in address.
import { supabase } from "@/integrations/supabase/client";

export type Profile = { id: string; username: string; color: string; kills: number; best_wave: number; matches: number };

const clean = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
const addr = (u: string) => `${clean(u)}@scrapfall.local`;

export async function loadProfile(): Promise<Profile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  if (data) return data as Profile;
  const username = String(u.user.user_metadata?.["username"] ?? u.user.email?.split("@")[0] ?? "player");
  const { data: made } = await supabase.from("profiles").insert({ id: u.user.id, username }).select("*").single();
  return (made as Profile) ?? null;
}

export async function signUp(username: string, password: string) {
  const name = clean(username);
  if (name.length < 3) throw new Error("Username needs 3+ letters or numbers");
  if (password.length < 6) throw new Error("Password needs 6+ characters");
  const { error } = await supabase.auth.signUp({ email: addr(name), password, options: { data: { username: name } } });
  if (error) throw new Error(/registered|exists/i.test(error.message) ? "That username is taken" : error.message);
  return loadProfile();
}

export async function signIn(username: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: addr(username), password });
  if (error) throw new Error("Wrong username or password");
  return loadProfile();
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function saveColor(p: Profile, color: string) {
  await supabase.from("profiles").update({ color }).eq("id", p.id);
}

export async function recordRun(p: Profile, kills: number, wave: number): Promise<Profile> {
  const next = { kills: p.kills + kills, matches: p.matches + 1, best_wave: Math.max(p.best_wave, wave) };
  await supabase.from("profiles").update(next).eq("id", p.id);
  return { ...p, ...next };
}
