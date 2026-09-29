# Working in this repo

Scrapfall is a browser FPS by Tyler and Toby Szakacs (Szakacs Media). It's live at https://szakacsmedia.com/game/. Several people and agents work on it in parallel, so these rules keep work from colliding and keep production safe.

Start with [`docs/REPO_MAP.md`](docs/REPO_MAP.md) to find where things live.

## The rules

- **`main` is production.** A merge to `main` deploys to szakacsmedia.com/game within a couple of minutes. `main` is protected:
  - every change goes through a pull request;
  - CI must pass;
  - nobody force-pushes;
  - only the repo owner, or whoever they delegate, merges.
- **One branch per piece of work**, off an up-to-date `origin/main`. Keep PRs focused, since several small PRs beat one giant one. Open a draft early and push as you go.
- **Stay up to date.** Run `git fetch && git merge origin/main` often. A branch that's behind `main` must be updated with `main` before merge, or it can undo work that already landed.
- **Work in your own git worktree** if other agents share the machine. Never switch branches in someone else's checkout.
- **Commit messages and PR descriptions are plain descriptions of the change.** No tool or assistant attribution lines ("Co-Authored-By", "Generated with …").
- **Don't touch another agent's area** without saying so in your PR. Current owners are listed under "Who's working where" below.

## Setup and checks

```sh
npm ci                  # npm, not bun
npm run dev             # dev server; open the URL it prints, under /game/
npm test                # unit tests (scripts/game-physics.test.mjs)
npm run typecheck       # tsc --noEmit
npm run build           # static build into dist/site/game
npm run smoke           # enters every map in headless Chromium and fails on any console error
npm run check           # all of the above, in order: run this before you push
```

The first time, `npm run smoke` needs `npx playwright install chromium`. To serve a production build locally, run `npm run serve:static` (port 4173, same `/game/` routing as Vercel).

CI (`.github/workflows/ci.yml`) runs tests, typecheck, build, the repo-map check and the smoke test on every PR. If CI is red, fix it; don't work around it.

## Testing in the game

URL parameters:

| Param | Effect |
| --- | --- |
| `?map=vice\|gulch\|pier\|whiteout\|nuketown` | Force a map (a substring of the name, or an index) |
| `?time=night\|sunset` | Time of day |
| `?weather=sunny\|rain\|night\|sunset` | Weather |
| `?seed=N` | The same generated layout every load |
| `?debug=1` | Exposes `window.__rs` (camera, enemies, `spawnWave(n)`, `gl`, traffic, `blockedAt`…) |
| `&tour=1` | No enemies: free walk |

The bar for "done":

- **Judge from random player-eye views**: 1.6 m eye height, random walkable spots and facings, night and sunset. Never judge from curated hero shots or aerials. Fix the worst frame, not the best.
- Nothing floating, clipping, see-through, or blocking invisibly. Anything that looks usable works.
- 0 console errors on every map.
- Co-op still works: two browser pages, a host plus a guest joining by code.
- No performance regressions (see below).
- The PR description says what changed, shows before-and-after evidence, and states plainly what you didn't verify.

## Measuring performance

- Headless browsers cap at 60 fps (vsync), so "60 fps before, 60 fps after" proves nothing. Measure **headroom** instead:
  - uncapped Chromium: `--disable-gpu-vsync --disable-frame-rate-limit`;
  - CPU ms per frame;
  - frame time p95 and p99;
  - frames over 25 ms and over 50 ms;
  - draw calls (`renderer.info`);
  - a 4x CPU throttle.
- Reproduce your "before" numbers against current `main`, and run the before and after builds alternately.
- `PlayerView.tsx` owns the one final `gl.render` per frame. Anything that renders the scene again doubles the cost.

## Co-op rules

- The host is authoritative. Guests send input and position; the host sends world state.
- **Append** new enemy kinds, message types and sync fields to the end. Never reorder or remove them: peers index them by position.
- Any change to the generated world, or to what's sent over the network, bumps the room `PREFIX` in `src/game/net.ts` by one version, with a comment line saying why. This keeps old and new builds out of each other's rooms.

## Code style

- Put new work in its own module and hook it into `src/game/Game.tsx` with a few lines. `Game.tsx` is shared by everyone, so big edits there cause merge conflicts.
- Match the surrounding code: comment density, naming, idiom.
- No per-frame allocations in `useFrame` or other hot paths. Reuse vectors and arrays.
- Visual features that cost frames must scale with the quality tier (`quality.ts`).
- Environment quirks that have bitten before:
  - three 0.186 has no `PCFSoftShadowMap`.
  - WebKit refuses port 4190.
  - `npx playwright install` can delete browser builds that other projects share.

## Toby's upstream repo

Toby's original Scrapfall lives in `tobyszaks/robotshooter`. His game changes are brought in here by hand. [`docs/UPSTREAM.md`](docs/UPSTREAM.md) records the last synced commit and where each change landed. The next sync diffs from that commit.

## Who's working where

This changes often, so check open PRs (`gh pr list`) before starting.

| Area | Paths |
| --- | --- |
| Pier and Whiteout | `src/game/beach/`, `src/game/alpine/`, `src/game/access/` |
| Dry Gulch layout | `src/game/western/` |
| Nuketown rebuild | `src/game/nuketown/` |
| Menus and HUD | `src/game/ui/` |
| Rendering | `src/game/PostFx.tsx` (if present), lighting, and the final render |
| Performance | `quality.ts`, `QualityGovernor.tsx`, hot paths |
