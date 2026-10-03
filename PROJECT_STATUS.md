# Four-map realism pass

Outcome: more lifelike Vice Heights, Pacific Pier, Dry Gulch, and Whiteout Pass. Call of Duty is the visual direction. Nuketown stays in development.

Authority: implement, verify, commit, push, and prepare a PR. This new art pass needs visual review before merge. Production has not changed.

Base: origin/main 3810afe3e80d3fd422e671c444f335cc3d8c0a5e. Branch: codex/four-map-realism. Worktree: /Users/tyler/Projects/Worktrees/Scrapfall/four-map-realism.

Implemented: scanned materials; branch-and-leaf crowns; snow-laden spruce; natural lighting; grounded shrubs; wall grain, edge bevels and service grilles; church construction detail. Public Nuketown URLs, seeds, scene assets and development rooms are isolated.

Verified: 54 logic tests including development-room isolation; typecheck; production build; night/sunset smoke; movement, ammo, skiing, lifts, driving, shops; co-op host transfer and fresh join; small-screen low-quality map entries; public Nuketown URL rejection. The final distant-foliage optimization has a separate smoke and performance rerun in progress.

Evidence: docs/qa/four-map-realism/README.md; http://127.0.0.1:18963/; /tmp/scrapfall-realism-*. Preview: http://127.0.0.1:5186/game/.

Remaining: finish the final rendering comparison, publish the draft PR, and obtain visual review before any new merge. Preserve the earlier playtest worktree and its dirty PROJECT_STATUS.md.
