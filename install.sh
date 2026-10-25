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

install_linux() {
  local architecture debian_architecture
  case "$(uname -m)" in
    aarch64|arm64) architecture=arm64; debian_architecture=arm64 ;;
    x86_64|amd64) architecture=x64; debian_architecture=amd64 ;;
    *) fail "The Linux download supports ARM64 and x64 only." ;;
  esac
  for command in curl sha256sum dpkg dpkg-deb apt-get pgrep id chmod; do
    command -v "$command" >/dev/null || fail "Linux installation requires $command. Use Debian/Ubuntu or download the package manually: $REPOSITORY/releases"
  done
  [[ "$(dpkg --print-architecture)" == "$debian_architecture" ]] || fail "The package manager architecture must match this $architecture system."
  if pgrep -f '/usr/lib/astra/astra([[:space:]]|$)' >/dev/null; then
    fail "Quit Astra before installing or updating it, then run this command again."
  fi
  local installer=(apt-get)
  if [[ "$(id -u)" != "0" ]]; then
    command -v sudo >/dev/null || fail "Linux installation requires sudo, or run this script as root."
    installer=(sudo apt-get)
  fi

  temporary=$(mktemp -d "${TMPDIR:-/tmp}/astra-download.XXXXXX")
  printf 'Finding the latest Astra release…\n'
  local latest_url version release_url linux_asset file
  latest_url=$(curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 60 --head -o /dev/null --write-out '%{url_effective}' "$REPOSITORY/releases/latest") || fail "Could not find a public release. Check $REPOSITORY/releases."
  [[ "$latest_url" == "$REPOSITORY/releases/tag/"* ]] || fail "The latest release returned an unexpected URL."
  version=${latest_url##*/}
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The release returned an unexpected version."
  release_url="$REPOSITORY/releases/download/$version"
  linux_asset="Astra-${version#v}-linux-$architecture.deb"
  printf 'Downloading Astra %s for Linux %s…\n' "$version" "$architecture"
  for file in "$linux_asset" "$linux_asset.sha256"; do
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 300 "$release_url/$file" -o "$temporary/$file" || fail "Download failed. No package installation was started."
  done
  local expected_hash checksum_name actual_hash package_name package_arch package_version package_release package_build
  read -r expected_hash checksum_name < "$temporary/$linux_asset.sha256"
  [[ "$expected_hash" =~ ^[a-fA-F0-9]{64}$ && "$checksum_name" == "$linux_asset" ]] || fail "The release checksum has an unexpected format."
  actual_hash=$(sha256sum "$temporary/$linux_asset")
  actual_hash=${actual_hash%% *}
  [[ "$actual_hash" == "$expected_hash" ]] || fail "The download checksum did not match. No package installation was started."
  package_name=$(dpkg-deb --field "$temporary/$linux_asset" Package) || fail "The downloaded Linux package could not be read."
  package_arch=$(dpkg-deb --field "$temporary/$linux_asset" Architecture) || fail "The Linux package architecture could not be read."
  package_version=$(dpkg-deb --field "$temporary/$linux_asset" Version) || fail "The Linux package version could not be read."
  [[ "$package_name" == "astra" && "$package_arch" == "$debian_architecture" ]] || fail "The downloaded package has the wrong identity or architecture."
  package_release=${version#v}
  package_build=${package_version#"$package_release-"}
  [[ "$package_version" == "$package_release-"* && "$package_build" =~ ^[1-9][0-9]*$ ]] || fail "The downloaded package has the wrong release version."

  chmod 755 "$temporary"
  chmod 644 "$temporary/$linux_asset"
  "${installer[@]}" install -y "$temporary/$linux_asset" || fail "APT could not install Astra. Resolve the package-manager error above and retry."
  printf '\nAstra %s is installed. Launch Astra from your applications menu.\n' "$version"
  printf 'Your saved apps and Codex configuration were not changed by this script.\n'
}

case "$(uname -s)" in
  Linux) install_linux; exit 0 ;;
  Darwin) ;;
  *) fail "This script supports macOS and Debian/Ubuntu Linux. On Windows, run in PowerShell: irm https://getastra.halcytron.chatgpt.site/install.ps1 | iex" ;;
esac
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
