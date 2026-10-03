/** Follow persisted auth, discarding profile requests from older sessions. */
export function followProfileSession<User extends { id: string }, Profile>(
  subscribe: (callback: (user: User | null) => void) => () => void,
  load: (user: User) => Promise<Profile>,
  update: (profile: Profile | null) => void,
  report: (error: unknown) => void,
  loading: (value: boolean) => void,
) {
  let revision = 0;
  let active = true;
  let userId: string | null = null;
  let pending = false;
  let restored = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = subscribe((user) => {
    // Refresh/focus notifications for the same account must not replace newer
    // stats or color edits with a background profile snapshot.
    if (user && user.id === userId && (pending || restored)) return;
    const changed = (user?.id ?? null) !== userId;
    userId = user?.id ?? null;
    restored = false;
    const request = ++revision;
    clearTimeout(timer);
    if (!user) { pending = false; update(null); loading(false); return; }
    if (changed) update(null);
    pending = true;
    loading(true);
    // Auth callbacks run under the auth client's lock. Query after it releases.
    timer = setTimeout(() => {
      void load(user).then((profile) => {
        if (active && request === revision) { restored = true; update(profile); }
      }).catch((error: unknown) => {
        if (active && request === revision) report(error);
      }).finally(() => {
        if (active && request === revision) { pending = false; loading(false); }
      });
    }, 0);
  });
  return () => { active = false; ++revision; clearTimeout(timer); unsubscribe(); };
}
