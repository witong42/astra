# Contributing to Astra

Start with the [README](README.md#installation). Astra is a small personal project; setup reliability and clear bug reports are especially welcome.

## Before changing code

- For a bug, include reproduction steps, expected and actual behavior, OS/architecture, Bun and Codex versions.
- For a larger feature, open an issue first so we can agree on scope.
- Use an isolated profile for experiments: `ASTRA_DATA_DIR=/absolute/path/to/test-profile bun start`. This keeps your normal saved apps separate. Codex still uses your existing account and configuration.
- Keep personal output in `~/.astra/`, outside the source checkout. Never commit credentials, `.env` files, hosting IDs, local paths, journals or generated personal apps.

## Checks

Use Bun and Biome. Add a regression test with behavior changes, and run:

```sh
bun run check
bun test
bun run build
ASTRA_REMOTE_URL=https://astra-backend.example.com bun run build:web
```

The native build supports macOS, Windows x64 and Linux. The packaged Linux releases support x64 and ARM64 (`.deb`). Mac builds also require Homebrew's `autoconf`, `automake` and `libtool`. Tests use fixtures rather than making model requests. The native capture test uses a real microphone on macOS; CI runs the remaining software tests with `bun test --test-name-pattern '^(?!native capture isolates microphone channels)'`. A passing suite doesn't establish voice availability for every Codex account or CLI release.

Keep each pull request focused. Describe the user-visible change, checks actually run, and remaining limits. Screenshots or a short recording help with UI changes; use anonymous data.

## Privacy and security reports

Don't publish secrets or sensitive reproduction data in an issue. If you believe you've found a vulnerability, use GitHub's private vulnerability reporting when it is enabled. Otherwise, open an issue asking for a private contact without including exploit details or personal data.

## Licensing

By contributing code, you agree to its distribution under Astra's MIT license. Preserve third-party notices and attribution when adding or changing assets or dependencies.
