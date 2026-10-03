# Accounts in the shared game

This is a selective port of Toby's account system from `toby-main` at
`2052a849e54887aeed44047d2caa004a4282a4d4`, including the login fixes developed at
`c3be04bd75e717a45f95e09b5b0a17956b9d9a2f`. It targets the existing shared game
at `/game/`; it does not copy Toby's engine, maps, routing, multiplayer or app scaffold.

## Before enabling accounts

Set these build-time public connection settings in the existing game's approved
Supabase project environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon key only)

Do not supply a service-role or secret key to a browser build. No live project
connection settings are committed by this port. Unconfigured builds still play;
the account dialog explains that accounts are currently unavailable.

The backend must already support Toby's username/password sign-in address convention
(`username@scrapfall.local`) and provide the existing `public.profiles` table:
`id`, `username`, `color`, `kills`, `best_wave`, `matches`, `created_at`.
Toby's existing defaults and unique ID/username constraints are expected. Profile
creation is client-side and tolerates concurrent creation without replacing stored totals.

Existing authenticated users must be allowed to select, insert and update only their
own profile, using `auth.uid() = id`. This port does not apply migrations, change
RLS, grant public reads, create triggers, configure auto-confirm signup, or change
backend authentication/access settings. If the selected backend needs any of those
changes, stop for the repo owner's approval and review a separate migration.
Global leaderboards are outside this port and would require a separate access design.

## Client behavior

Auth's initial persisted session restores the account. Logout/account switches invalidate
old profile reads. Same-account refresh/focus events retain newer local run totals;
failed restoration can retry on a later auth event. Login/signup has one auth-driven
profile-loading path. The account dialog surfaces auth/restoration/save errors.

Completed runs save personal kills, matches played and deepest completed wave.
Overtime retains the same run: later completion adds only additional kills and
updates the deepest wave without counting another match. Guests
keep the existing host-authoritative per-player kill credits. No network message or
room-version changes are made. Account state never enters the frame loop.

## Verification

- `npm test` includes session lifecycle, account service and existing gameplay/relay regressions.
- `npm run smoke:account` tests the existing `/game/` path against local mocked
  auth/profile responses: sign-in, exactly one read, refresh restoration, persistent logout.
  It creates no real users and does not contact a real backend.
- `npm run check` runs the existing tests, TypeScript, static build, all-map smoke and account smoke tests.

Before merging/deploying, use an existing owner-authorized account on the correctly
configured shared-game preview: sign in, refresh and confirm username/stats; log out,
refresh and confirm it stays logged out. Test a completed run and verify the saved totals.
Mock tests do not establish live backend behavior or a Lovable editor iframe session broker.
