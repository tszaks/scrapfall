<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Big maps live verbatim in src/bro (copied from tszaks/scrapfall, `@/` imports rewritten to `@/bro/`); only src/bro/game/BigMaps.tsx is ours — why: user requires exact copies, never recreations.
- vite.config.ts strips dev-only data-tsd-source from src/game and src/bro JSX — why: React Three Fiber crashes on that attribute when scene objects unmount.

- Accounts use Lovable Cloud auth with username mapped to an internal address and a profiles row created client-side — why: no email flow, no triggers on the auth schema.
- Third-person view only moves the camera inside scene before/after render — why: all game logic keeps using the eye position.
