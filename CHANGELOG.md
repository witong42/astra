# Changelog

Astra's history, from the first CodexOS prototype to the current release.
Early builds were used locally or through private sites; the dates below do not imply a public GitHub release. Local builds without distinct source revisions are grouped where their changes cannot be separated reliably.

## 0.5.1 — 2026-10-25

### Added

- Linux x64 packages alongside Linux ARM64.
- A macOS DMG with drag-to-Applications installation, plus the ZIP used by the command-line installer.
- One installation command for macOS and Debian/Ubuntu, and a PowerShell installation command for Windows.
- A complete release history, linked from the bilingual project site and READMEs.

### Fixed

- Linux native voice builds include the correct math-library notices and support concurrent recognition with the pthread OpenBLAS runtime.
- Installer checks allow native x64 validation to finish under emulation.
- Mac archives verify their signed application and release identity, include checksums, and refuse to overwrite an existing archive.
- Desktop packages exclude separate phone-client and marketing build output.
- Fresh source installs download the pinned Electron runtime before desktop checks and startup.
- Linux ARM64 packages target Ubuntu 24.04 rather than requiring a newer development system's glibc.

### Changed

- The website presents downloads for macOS, Windows x64, Linux x64 and Linux ARM64.
- English and French website copy is shorter, with decorative arrows, redundant captions and repeated installation notes removed.
- Site builds carry the application version and build number from the package metadata.

## 0.5.0 — 2026-10-25

### Added

- Native Linux support, initially packaged for Debian/Ubuntu on ARM64.
- Bundled Linux voice runtime, speech models, desktop launcher and CLI.
- Native Linux shell actions for mini-app controls.

### Changed

- Installation and platform documentation expanded beyond macOS and Windows.

## 0.4.0 — 2026-10-25

### Added

- Windows x64 desktop packaging, native voice assets and a per-user installer with a Start menu shortcut.
- A packaged Windows CLI that runs through Electron without requiring a separate Bun installation.
- PowerShell actions for Windows mini-app controls, with arguments passed as data.

### Changed

- Shared platform configuration preserves existing profiles and locates Codex on macOS, Windows and Linux.
- The Astra identity, logo, offline typeface and GitHub bundle identifier are shared across clients.

## 0.3.2–0.3.6 — Local build series, 2026-10-24–25

These builds were not each recorded as a separate source revision. Their changes are grouped instead of assigning an uncertain fix to an individual patch.

### Added

- English and French READMEs, contribution guidance, licensing and third-party notices for the open-source preparation.
- A separate bilingual project and download site, with a demo, mini-app gallery and macOS installer.
- Checksum and application-identity verification before an installer replaces a Mac application.
- Local Vosk recognition for French and English wake words and shortcuts, with the models bundled in the app by 0.3.6.
- A real English voice demo showing Astra create a dashboard, with Astra's spoken replies and captions.

### Fixed

- Buffered speech survives wake-up and the transition into a live conversation.
- Slow audio uploads and connection backlogs preserve the phone's recent speech and keep errors visible.
- Phone microphone ownership is respected across call rotation and disconnects; desktop listening resumes only when it was previously enabled.
- Complete bundle replacement keeps the renderer, preload and main process on the same IPC generation.
- The galaxy renders reliably when reduced motion is enabled.

### Changed

- Voice can be paused and resumed from the Home galaxy.
- The initial promotional pitch was replaced with footage of the actual application.
- Project presentation and downloads are separated from the personal phone client and its private backend access.
- Public-facing builds include curated media rather than personal journals, generated apps or raw captures.

## 0.3.1 — 2026-10-24

### Added

- An assistant-callable voice pause command, including direct handling of spoken pause requests without an extra backend handoff.

### Changed

- Generated creations and assets use `~/.astra/` instead of the application source repository.
- New mini-apps and the Home assistant start in the personal directory; explicitly chosen project folders remain supported.
- Resumed Codex threads use the saved working directory without changing app identities or history.

## 0.3.0 — 2026-10-24

### Added

- A French/English interface switch on desktop and phone.
- A saved language preference for each device, including translated controls, dates and audio-recovery messages.

### Fixed

- Changing the interface language preserves drafts, canvas state and voice sessions. Speech language does not silently change the interface language.

## 0.2.2 — 2026-10-24

### Fixed

- Blocked browser audio playback is reported and can be resumed, including on Android Brave.

### Changed

- A starry Astra application icon and an animated mini-app button that reflects voice state.
- Native application, Dock and in-app artwork are packaged and checked together.

## 0.2.1 — 2026-10-24

### Fixed

- Phone audio uploads are batched to work across slower networks.
- Hosted mini-app frames retain their scripts and shared data without the cross-origin errors caused by injected host scripts.

## 0.2.0 — 2026-10-24

### Added

- A private phone web client connected to the same desktop backend through HTTPS and Tailscale, using the existing Codex account.
- Shared mini-apps, journal and controls across desktop and phone while the computer stays on.
- Application versions and build numbers in the interface and macOS bundle.

### Changed

- Packaging preserves previous releases instead of copying a new application over an existing bundle.
- Phone ownership and autosave rules preserve device-local edits during desktop and phone activity.

## 0.1.0 — 2026-10-23–24

### Added

- The first Electron desktop prototype, initially named CodexOS, built around existing Codex sessions.
- Live generated workspaces, followed by editable Substrate HTML/CSS/JavaScript canvases and hybrid OpenUI layouts.
- Independent app sessions, background work and mid-turn steering.
- A Home launcher, saved mini-apps, favorites, short names, permanent app deletion and richer icons.
- A Markdown conversation drawer and a persistent journal of assistant, voice and tool activity.
- Initial voice interaction and mini-app orchestration, followed by direct live Codex voice integration.
- Native AppleScript actions and locally usable mini-app controls on macOS.

### Changed

- The project became Astra, with its galaxy Home and Solar mini-app icons.
- Workspace navigation and model controls remain available during generation.

### Fixed

- Canvas links open externally without replacing the running app.
- Conversation remains available when a canvas cannot be saved.
- Markdown and generated surfaces are validated without executing unsafe content in the host interface.
