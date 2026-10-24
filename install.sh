#!/bin/bash
set -euo pipefail
umask 077

REPOSITORY="https://github.com/witong42/Astra"
RELEASE_API="https://api.github.com/repos/witong42/Astra/releases/latest"
ASSET="Astra-macos-arm64.zip"
BUNDLE_ID="local.codexos.desktop"
temporary=""
staging=""
previous=""
destination=""

fail() { printf 'Astra: %s\n' "$*" >&2; exit 1; }
cleanup() {
  if [[ -n "$previous" && -d "$previous" && ! -e "$destination" ]]; then
    mv "$previous" "$destination"
  fi
  [[ -z "$temporary" ]] || rm -rf "$temporary"
  [[ -z "$staging" ]] || rm -rf "$staging"
}
trap cleanup EXIT

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer requires macOS."
[[ "$(uname -m)" == "arm64" ]] || fail "The current download supports Apple Silicon Macs. Intel builds are not available yet."
for command in curl ditto codesign plutil shasum pgrep; do
  command -v "$command" >/dev/null || fail "Required macOS command is missing: $command"
done
if pgrep -f '/[A]stra.app/Contents/MacOS/' >/dev/null; then
  fail "Quit Astra before installing or updating it, then run this command again."
fi

if [[ -n "${ASTRA_INSTALL_DIR:-}" ]]; then
  install_directory="$ASTRA_INSTALL_DIR"
elif [[ -w /Applications ]]; then
  install_directory="/Applications"
else
  install_directory="$HOME/Applications"
fi
[[ "$install_directory" == /* ]] || fail "ASTRA_INSTALL_DIR must be an absolute directory."
destination="$install_directory/Astra.app"
if [[ -e "$destination" ]]; then
  current_id=$(plutil -extract CFBundleIdentifier raw -o - "$destination/Contents/Info.plist" 2>/dev/null) || fail "An unrecognized Astra.app already exists at $destination. Keep it safe and choose another installation directory."
  [[ "$current_id" == "$BUNDLE_ID" ]] || fail "An unrelated application already exists at $destination."
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/astra-download.XXXXXX")
printf 'Finding the latest Astra release…\n'
curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 60 "$RELEASE_API" -o "$temporary/release.json" || fail "Could not find a public release. Check $REPOSITORY/releases."
version=$(plutil -extract tag_name raw -o - "$temporary/release.json") || fail "The release response did not include a version."
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The release returned an unexpected version."
release_url="$REPOSITORY/releases/download/$version"
printf 'Downloading Astra %s for Apple Silicon…\n' "$version"
for file in "$ASSET" "$ASSET.sha256"; do
  curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 300 "$release_url/$file" -o "$temporary/$file" || fail "Download failed. No installed application was changed."
done
read -r expected_hash checksum_name < "$temporary/$ASSET.sha256"
[[ "$expected_hash" =~ ^[a-fA-F0-9]{64}$ && "$checksum_name" == "$ASSET" ]] || fail "The release checksum has an unexpected format."
actual_hash=$(shasum -a 256 "$temporary/$ASSET")
actual_hash=${actual_hash%% *}
[[ "$actual_hash" == "$expected_hash" ]] || fail "The download checksum did not match. No installed application was changed."
ditto -xk "$temporary/$ASSET" "$temporary/unpacked" || fail "The application archive could not be unpacked."
application="$temporary/unpacked/Astra.app"
[[ -d "$application" && ! -L "$application" ]] || fail "The archive did not contain an Astra application."
downloaded_id=$(plutil -extract CFBundleIdentifier raw -o - "$application/Contents/Info.plist") || fail "The application identity could not be read."
[[ "$downloaded_id" == "$BUNDLE_ID" ]] || fail "The downloaded application has the wrong identity."
codesign --verify --deep --strict "$application" || fail "Application signature verification failed. No installed application was changed."

mkdir -p "$install_directory"
staging=$(mktemp -d "$install_directory/.astra-install.XXXXXX")
ditto "$application" "$staging/Astra.app"
codesign --verify --deep --strict "$staging/Astra.app" || fail "The staged application did not pass signature verification."
if [[ -d "$destination" ]]; then
  previous="$staging/previous.app"
  mv "$destination" "$previous"
fi
mv "$staging/Astra.app" "$destination" || fail "Installation failed; restoring the previous application."
printf '\nAstra %s is installed at %s\n' "$version" "$destination"
printf 'Use your existing Codex CLI and ChatGPT sign-in. Your saved apps and Codex configuration were not changed.\n'
printf 'On first launch, follow the normal macOS app, microphone and speech-recognition prompts.\n'
if [[ "${ASTRA_NO_OPEN:-0}" != "1" ]]; then
  if ! open "$destination"; then
    printf 'Astra is installed. Open %s manually to complete first launch.\n' "$destination" >&2
  fi
fi
