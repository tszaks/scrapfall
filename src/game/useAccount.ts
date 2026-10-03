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
  const identity = useRef<string | null | undefined>(undefined);
  const pending = useRef<
    Array<{ runId: number; kills: number; waves: number; userId: string | undefined }>
  >([]);
  useEffect(() => {
    if (!accountsConfigured) return;
    return watchProfile(
      (p) => {
        current.current.profile = p;
        setProfile(p);
        setError("");
      },
      () => setError("Could not restore your account. Check your connection and log in again."),
      setLoading,
      (userId) => {
        if (identity.current === userId) return;
        // Only the first resolved session can claim endings from initial loading.
        pending.current =
          identity.current === undefined && userId
            ? pending.current.map((run) => ({ ...run, userId }))
            : [];
        identity.current = userId;
        current.current.revision++;
      },
    );
  }, []);
  const captured = useRef(false);
  const saved = useRef<SavedRun | null>(null);
  const writes = useRef(Promise.resolve());
  const uncertainRun = useRef<SavedRun | null>(null);
  useEffect(() => {
    const { profile: p, revision } = current.current;
    if (!ended) captured.current = false;
    else if (!captured.current) {
      captured.current = true;
      if (p || loading || identity.current)
        pending.current.push({
          runId,
          kills,
          waves: wavesSurvived,
          userId: identity.current ?? p?.id,
        });
    }
    if (!p || loading) return;
    // Capture before an arena reset replaces score/wave state; flush even mid-run.
    const endings = pending.current.splice(0);
    for (const ending of endings) {
      if (ending.userId !== p.id) continue;
      const nextRun = { runId: ending.runId, userId: p.id, kills: ending.kills };
      writes.current = writes.current.then(async () => {
        if (current.current.revision !== revision) return;
        if (uncertainRun.current?.runId === ending.runId && uncertainRun.current.userId === p.id) {
          setError("This run's save is uncertain. Start a new arena before saving another run.");
          return;
        }
        const credit = runCredit(saved.current, nextRun);
        try {
          const next = await recordRun(p, credit.kills, ending.waves, credit.matches);
          saved.current = nextRun;
          if (current.current.revision === revision && current.current.profile?.id === p.id) {
            current.current.profile = next;
            setProfile(next);
            setError("");
          }
        } catch {
          uncertainRun.current = nextRun;
          if (current.current.revision === revision)
            setError(
              "Run save failed or is uncertain. Start a new arena before saving another run.",
            );
        }
      });
    }
  }, [ended, profile?.id, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return { profile, loading, error, configured: accountsConfigured };
}
export type AccountState = ReturnType<typeof useAccount>;
