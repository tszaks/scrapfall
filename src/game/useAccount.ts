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
  useEffect(() => {
    if (!ended) {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    recorded.current = true;
    const { profile: p, revision } = current.current;
    if (!p) return;
    const nextRun = { runId, userId: p.id, kills };
    const credit = runCredit(saved.current, nextRun);
    void recordRun(p, credit.kills, wavesSurvived, credit.matches)
      .then((next) => {
        if (current.current.revision === revision && current.current.profile?.id === p.id) {
          saved.current = nextRun;
          current.current.profile = next;
          setProfile(next);
        }
      })
      .catch(() => {
        if (current.current.revision === revision)
          setError("Could not save your run. Check your connection.");
      });
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps
  return { profile, loading, error, configured: accountsConfigured };
}
export type AccountState = ReturnType<typeof useAccount>;
