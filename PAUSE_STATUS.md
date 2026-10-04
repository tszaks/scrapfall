# Host-controlled live pause

Outcome: an explicit host pause freezes the room until its host resumes, with clear guest status and live connection health.
State: implemented; reviewed runtime candidate `7854519f5b4f400f6b1c215dafbe88d5d66e58c4`.
Branch/worktree: codex/host-live-pause; task-6/pause-worktree.

Includes released PR47/49 and reviewed PR50 recovery dependency. Runtime review clean after three rounds. Node22 required check passed: 89/89 tests, typecheck/build, eight map/time smoke cases with zero errors. All four offered maps passed pause/settings/resume. See [QA record](docs/qa/host-live-pause/README.md).

Boundaries: preserve PR50 recovery ledger/status handling; no pause-authored revive.ts changes. Shared Game/Traffic/UI/map hunks coordinated through parent. Namespace v25, one above current main v24. No physical controller acceptance or quantitative performance benchmark claimed.

Design: local menus and pointer-lock/focus loss do not pause a co-op room. Explicit host keyboard/controller/touch pause does. Solo menu retains pause behavior. Authority transfer retains pause; new host resumes. Reconnection waits for host state. Discard in-flight guest gameplay during pause; retain heartbeats and initial world replay. Frame callbacks drop resume delta.

Remaining: final integrated-head two-page repeat after parent’s CPU measurement window; required remote CI; parent release slot after PR50; normal merge, exact production SHA and live verification. Earlier ten-checkpoint real PeerJS run passed. All test browsers are closed; no heavy local jobs remain.
