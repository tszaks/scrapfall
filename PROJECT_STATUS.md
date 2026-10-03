# Nuketown development-only release

Outcome: exclude unfinished Nuketown from public play and the production scene bundle. Preserve development access.

Authority: Tyler explicitly said Nuketown must not be public; the thread also authorizes merging and deploying. This focused restriction is separate from the four-map art pass, which awaits visual review.

Base: origin/main 3810afe. Branch: codex/nuketown-development-only. No art changes.

Checks: full local gate passes (54 tests, types, build, eight public scene runs), including development/public room isolation and production bundle exclusion. Development Nuketown entry works; both baseline and candidate emit the same pre-existing React development-root warning. CI, merge, deployment and live verification remain pending.
