# Unmeasured camera revision

The initial measured camera at `b038d4d` remains the subject of [performance.md](performance.md). Its measurements do not apply to the later revision below.

The local revision through `9107aa7` changes only the chase implementation and its tests:

- A tighter size-aware reserve changes the boom from `max(half + 4, radius / sin(halfFov) / 0.72)` to `max(half + 3, radius / sin(halfFov) / 0.82)`. The default FOV remains 83°. All hull corners stay inside the tested viewport bounds for compact cars, sedans and buses in landscape and portrait, including extreme look pitch/orbit and forward/reverse sedan turns.
- All seven collision offsets remain. After any ray finds cover, later rays stop at that prefix; their returned fractions compose back into the original boom fraction. This saves work near cover without caching collision across moving frames.
- The chase updates the existing presentation camera directly. Logical camera state is copied and its wider projection rebuilt only when the logical camera/lens changes. On-foot reset invalidates the lens cache so reentry restores the chase projection.

Independent source reviews found no blocking issues. Ten pure camera tests and typecheck pass. The updated build still needs full checks, actual rendered screenshots, low-overhang/slope routes, and a coordinated paired performance comparison. This revision is not a measured performance fix or a release pass. The camera PR remains held on the repository's performance guard.
