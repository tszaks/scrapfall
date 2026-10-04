# Unmeasured camera revision

The initial measured camera at `b038d4d` remains the subject of [performance.md](performance.md). Its measurements do not apply to the later revision below.

The local revision through runtime `758da74` with expanded checks changes only the chase implementation and its tests:

- A tighter size-aware reserve changes the boom from `max(half + 4, radius / sin(halfFov) / 0.72)` to `max(half + 3, radius / sin(halfFov) / 0.82)`. The default FOV remains 83°. All hull corners stay inside the tested viewport bounds for compact cars, sedans and buses in landscape and portrait, including extreme look pitch/orbit and forward/reverse sedan turns.
- All seven collision offsets remain. After any ray finds cover, later rays stop at that prefix; their returned fractions compose back into the original boom fraction. This saves work near cover without caching collision across moving frames.
- The chase updates the existing presentation camera directly. Logical camera state is copied and its wider projection rebuilt only when the logical camera/lens changes. On-foot reset invalidates the lens cache so reentry restores the chase projection.

Independent source reviews found no blocking issues. The full 96-test suite, typecheck, production build, repo-map and eight-map night/sunset smoke pass. Ten focused camera tests pass, including a fixed rising-plane check. Nine [rendered camera/lifecycle checkpoints](optimized/camera.json) pass on rebuilt port 5307, including actual rendered hull bounds, exit, ownership loss, death, and Leave game→new match restoration. [Sedan](optimized/sedan.png) and [8.8 m bus](optimized/large-car.png) screenshots were inspected. The bus is fully visible, but a hanging signal obstructs the upper road view; the earlier camera fixture also had this obstruction. Static-camera clearance alone does not prove all visual occluders are handled. Real low-overhang/slope routes, permanent network-failure behavior, and a coordinated paired performance comparison remain outstanding. This revision is not a measured performance fix or a release pass. The camera PR remains held on the repository's performance guard.
