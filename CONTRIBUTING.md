# Contributing to Scrapfall

Scrapfall is a game by Tyler and Toby Szakacs (Szakacs Media). The source is public so people can read it and learn from it. The [license](LICENSE) reserves all rights, and it says that contributions made here are under those terms and give the owners the right to use them.

Because of that, **we do not accept outside code or asset pull requests by default.** If you want to change something, open an issue first and say what you have in mind. If we want it, we will invite a pull request. A pull request we did not ask for may be closed without review. That is not a comment on your work.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## What is welcome

- **Bug reports.** Use the template. Say the map, the difficulty, whether you were solo or in co-op, and your browser and device. A `?seed=N` value helps us rebuild the same layout.
- **Ideas and feedback.** Open a feature request. Describe the problem first.
- **Security problems.** Go through [SECURITY.md](SECURITY.md), not a public issue.
- **Questions about reuse.** The code and art are not licensed for reuse. Ask first: https://szakacsmedia.com

## For invited contributors and maintainers

[AGENTS.md](AGENTS.md) is the working guide: branch rules, checks, co-op rules and code style. The short version:

```sh
npm ci                  # npm, not bun
npm run dev             # open the printed URL, under /game/
npm run check           # tests, typecheck, build and the smoke test
```

You need Node.js 20.19 or newer. The first `npm run smoke` needs `npx playwright install chromium`.

- **Match the surrounding code.** Same naming, same comment density, same idiom.
- Keep pull requests small and focused, from your own branch off an up-to-date `main`. `main` deploys to production, so CI (the `checks` job) must pass.
- Put new work in its own module and hook it into `src/game/Game.tsx` with a few lines.
- Co-op: append new message types and sync fields to the end, and bump the room `PREFIX` in `src/game/net.ts` when the world or the network format changes.
- Add a folder under `src/`? Add a line for it to [docs/REPO_MAP.md](docs/REPO_MAP.md), or CI fails.

## Pull request checklist

- [ ] `npm run check` passes locally.
- [ ] The change is small and focused.
- [ ] The code matches the surrounding style.
- [ ] The PR says what changed, shows before-and-after evidence for visible changes, and says what you did not verify.
- [ ] Co-op still works (a host and a guest) if you touched the network, the world or enemy sync.

## License

See [LICENSE](LICENSE). Contributions are made under those terms.
