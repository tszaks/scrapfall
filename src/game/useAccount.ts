import { useEffect, useRef, useState } from "react";
import { recordRun, runCredit, watchProfile, type Profile, type SavedRun } from "./account";
import { accountsConfigured } from "./accountClient";

/** Account state is outside the game loop; refresh/focus keeps local run totals. */
export function useAccount(ended: boolean, kills: number, wavesSurvived: number, runId: number) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(accountsConfigured);
  const [error, setError] = useState("");
  const current = useRef({ profile, revision: 0 });
  current.current.profile = profile;
  useEffect(() => {
    if (!accountsConfigured) return;
    return watchProfile(
      (p) => {
        if (current.current.profile?.id !== p?.id) current.current.revision++;
        current.current.profile = p;
        setProfile(p);
        setError("");
      },
      () => setError("Could not restore your account. Check your connection and log in again."),
      setLoading,
    );
  }, []);
  const recorded = useRef(false);
  const saved = useRef<SavedRun | null>(null);
  const writes = useRef(Promise.resolve());
  const uncertainRun = useRef<number | null>(null);
  useEffect(() => {
    if (!ended) {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    const { profile: p, revision } = current.current;
    if (!p || loading) return;
    recorded.current = true;
    const nextRun = { runId, userId: p.id, kills };
    writes.current = writes.current.then(async () => {
      if (current.current.revision !== revision) return;
      if (uncertainRun.current === runId) {
        setError("This run's save is uncertain. Start a new arena before saving another run.");
        return;
      }
      const credit = runCredit(saved.current, nextRun);
      try {
        const next = await recordRun(p, credit.kills, wavesSurvived, credit.matches);
        saved.current = nextRun;
        if (current.current.revision === revision && current.current.profile?.id === p.id) {
          current.current.profile = next;
          setProfile(next);
        }
      } catch {
        uncertainRun.current = runId;
        if (current.current.revision === revision)
          setError("Run save failed or is uncertain. Start a new arena before saving another run.");
      }
    });
  }, [ended, profile?.id, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return { profile, loading, error, configured: accountsConfigured };
}
export type AccountState = ReturnType<typeof useAccount>;
