# Working in this repo

- `main` deploys to production (https://szakacsmedia.com/game/) and is protected: every
  change goes through a pull request. Never force-push.
- Before opening a PR, run: `npm test`, `npx tsc --noEmit` and `npm run build`.
- Check changes in the real game at eye height, on every affected map, at night and at
  sunset. The worst frame is the bar, not the best one.
- Keep new work in its own modules with small hooks into `src/game/Game.tsx`.
- Co-op is host-authoritative. Append new enemy kinds or sync fields; never reorder them.
