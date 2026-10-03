/** Follow persisted auth, discarding profile requests from older sessions. */
export function followProfileSession<User, Profile>(
  subscribe: (callback: (user: User | null) => void) => () => void,
  load: (user: User) => Promise<Profile>,
  update: (profile: Profile | null) => void,
  report: (error: unknown) => void,
  loading: (value: boolean) => void,
) {
  let revision = 0;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = subscribe((user) => {
    const request = ++revision;
    clearTimeout(timer);
    if (!user) { update(null); loading(false); return; }
    loading(true);
    // Auth callbacks run under the auth client's lock. Query after it releases.
    timer = setTimeout(() => {
      void load(user).then((profile) => {
        if (active && request === revision) update(profile);
      }).catch((error: unknown) => {
        if (active && request === revision) report(error);
      }).finally(() => {
        if (active && request === revision) loading(false);
      });
    }, 0);
  });
  return () => { active = false; ++revision; clearTimeout(timer); unsubscribe(); };
}
