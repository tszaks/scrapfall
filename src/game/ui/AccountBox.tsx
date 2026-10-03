import { useState } from "react";
import { MenuButton, SectionLabel } from "./kit";
import { signIn, signOut, signUp } from "../account";
import type { AccountState } from "../useAccount";

export function AccountBox({ account, onClose }: { account: AccountState; onClose: () => void }) {
  const { profile, loading: accountLoading, error: accountError, configured } = account;
  const [mode, setMode] = useState<"in" | "up">("in");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy || accountLoading) return;
    setBusy(true);
    setErr("");
    try {
      await (mode === "in" ? signIn : signUp)(user, pass);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    }
    setBusy(false);
  };
  const field =
    "pointer-events-auto w-full rounded-md border-2 border-[#f3e6cf]/35 bg-[#161009]/60 px-3 py-2 text-sm font-bold tracking-[0.15em] text-[#f3e6cf] placeholder:text-[#f3e6cf]/50 focus:border-[#e7b25c] focus:outline-none";
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#0b0a09]/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        className="w-full max-w-xs rounded-lg border-2 border-[#f3e6cf]/30 bg-[#1d150d] p-4 text-[#f3e6cf]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center justify-between">
          <SectionLabel className="text-[#e7b25c]">ACCOUNT</SectionLabel>
          <button type="button" aria-label="Close account" onClick={onClose}>
            ×
          </button>
        </div>
        {!configured && (
          <div role="status" className="mt-2 text-sm">
            Accounts are unavailable right now.
          </div>
        )}
        {(err || accountError) && profile && <div role="alert">{err || accountError}</div>}
        {!configured ? null : accountLoading ? (
          <div className="mt-2 text-sm">Restoring account…</div>
        ) : profile ? (
          <div className="mt-2 space-y-1 text-[12px] font-bold tracking-[0.15em]">
            <div className="text-lg tracking-[0.2em]">{profile.username.toUpperCase()}</div>
            <div>TOTAL KILLS · {profile.kills}</div>
            <div>BEST WAVE · {profile.best_wave}</div>
            <div>RUNS PLAYED · {profile.matches}</div>
            <div className="flex gap-2 pt-3">
              <MenuButton
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={async () => {
                  try {
                    await signOut();
                  } catch {
                    setErr("Could not log out. Try again.");
                  }
                }}
              >
                Log out
              </MenuButton>
              <MenuButton variant="primary" size="sm" className="flex-1" onClick={onClose}>
                Done
              </MenuButton>
            </div>
          </div>
        ) : (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            <input
              className={field}
              placeholder="USERNAME"
              aria-label="Username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
            />
            <input
              className={field}
              placeholder="PASSWORD"
              aria-label="Password"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
            {(err || accountError) && (
              <div role="alert" className="text-[11px] font-bold tracking-widest text-[#ffb4a8]">
                {(err || accountError).toUpperCase()}
              </div>
            )}
            <MenuButton
              variant="primary"
              size="md"
              className="w-full"
              type="submit"
              disabled={busy || !user || !pass}
            >
              {busy ? "…" : mode === "in" ? "Log in" : "Create account"}
            </MenuButton>
            <button
              type="button"
              className="pointer-events-auto w-full text-center text-[11px] font-bold tracking-[0.2em] text-[#e7b25c]"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setErr("");
              }}
            >
              {mode === "in" ? "NEW HERE? CREATE AN ACCOUNT" : "HAVE AN ACCOUNT? LOG IN"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
