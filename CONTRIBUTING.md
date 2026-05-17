# Contributing

Thanks for contributing!

## Quick start

1. Fork the repo and create a branch:
   - `git checkout -b my-change`
2. Install dependencies:
   - `npm install`
3. Run in dev mode:
   - `npm run dev`
4. Build before opening a PR:
   - `npm run build`

## Project goals (scope)

This is a **simple relay bridge** (Discord bot + Matrix bot + Discord webhook):

- Keep setup easy for hobby/self-hosted use.
- Prefer correctness and clarity over lots of features.
- Avoid large “appservice/puppeting” scope creep.

## Coding guidelines

- Use TypeScript, keep changes small and focused.
- Keep logs actionable (include mapping/channel/room IDs but don’t print tokens).
- Preserve existing style (ESM, `strict` TS).
- Prefer handling errors by logging and continuing rather than crashing the process.

## Adding / testing features

When you change bridging behavior:

- Test Discord → Matrix and Matrix → Discord
- Test replies, reactions, and edits if applicable
- Verify loops are not created (bot should not re-bridge its own output)

## Reporting bugs

Please open a Bug Report issue and include:

- What you expected vs what happened
- Discord.js version, Node version, and your homeserver
- Sanitized logs (remove tokens)
- Your config shape (IDs ok, tokens removed)

## License

By contributing, you agree your contributions are licensed under the project license (see `LICENSE`).
