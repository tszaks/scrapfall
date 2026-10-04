# Host-controlled live pause

Outcome: an explicit host pause freezes the room until its host resumes, with clear guest status and live connection health.
State: in progress. Base main: 01f723efd9a18272e3a657869fe3ef54a34f395e.
Branch/worktree: codex/host-live-pause; task-6/pause-worktree.

Boundaries: preserve PR50 recovery ledger/status handling; no revive.ts changes. Coordinate shared Game/Traffic/UI hunks through parent. Namespace assigned one above final main. No performance benchmarks or visible browser focus.

Design: local menus and pointer-lock/focus loss do not pause a co-op room. Explicit host keyboard/controller/touch pause does. Solo menu retains pause behavior. Authority transfer retains pause; new host resumes. Reconnection waits for host state. Discard in-flight guest gameplay during pause; retain heartbeats and initial world replay. Frame callbacks drop resume delta.

Remaining: implement protocol/UI, focused unit and authorized headless two-page tests, exact-head independent review, required checks, parent release slot, normal merge/exact production SHA/live verification.
