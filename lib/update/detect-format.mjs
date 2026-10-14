import { existsSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const installRoot = fileURLToPath(new URL("../../", import.meta.url));
const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";

const SAFE_REF = /^[A-Za-z0-9._-]+$/;
const SAFE_TAG = /^v?[0-9A-Za-z._-]+$/;

export function isSafeGithubRef(value) {
  return typeof value === "string" && SAFE_REF.test(value) && value !== "." && value !== ".." && value.length <= 100;
}

export function isSafeTag(value) {
  return typeof value === "string" && SAFE_TAG.test(value) && value.length <= 64;
}

/**
 * Detect how Cloudflare One WARP was installed.
 * Override with CLOUDFLARE_ONE_WARP_INSTALL_FORMAT=appimage|deb|rpm|arch|flatpak|snap|homebrew|source
 */
function detectKnownFormat(env = process.env) {
  const override = (env.CLOUDFLARE_ONE_WARP_INSTALL_FORMAT || "").toLowerCase().trim();
  if (["appimage", "deb", "rpm", "arch", "flatpak", "snap", "homebrew", "source"].includes(override)) return override;

  if (env.APPIMAGE || env.APPDIR) return "appimage";
  if (env.FLATPAK_ID) return "flatpak";
  if (env.SNAP) return "snap";

  const argv0 = process.argv[1] || "";
  if (/\.AppImage$/i.test(argv0) || /\.AppImage$/i.test(env.CLOUDFLARE_ONE_WARP_APPIMAGE_PATH || "")) {
    return "appimage";
  }

  if (/\/Cellar\/cloudflare-one-warp\//.test(argv0) || (env.HOMEBREW_PREFIX && argv0.startsWith(`${env.HOMEBREW_PREFIX}/`))) return "homebrew";

  if (existsSync("/var/lib/dpkg/info/cloudflare-one-warp.list") || existsSync("/var/lib/dpkg/info/cloudflare-one-gui.list")) {
    return "deb";
  }

  return null;
}

export function detectInstallFormat(env = process.env) {
  const known = detectKnownFormat(env);
  if (known) return known;

  try {
    execFileSync("rpm", ["-q", "cloudflare-one-warp"], { stdio: "ignore", timeout: 1500 });
    return "rpm";
  } catch {
    // not an rpm install
  }

  try {
    execFileSync("pacman", ["-Q", "cloudflare-one-warp"], { stdio: "ignore", timeout: 1500 });
    return "arch";
  } catch {
    // Installed paths alone cannot identify a package manager.
  }

  return "source";
}

// Update requests must not block the daemon while package managers respond.
let packageFormatProbe = null;
export async function detectInstallFormatAsync(env = process.env) {
  const known = detectKnownFormat(env);
  if (known) return known;
  if (!packageFormatProbe) {
    const installed = (command, args) => new Promise((resolve) => {
      execFile(command, args, { timeout: 1500, maxBuffer: 4096 }, (error) => resolve(!error));
    });
    packageFormatProbe = (async () => {
      if (await installed("rpm", ["-q", "cloudflare-one-warp"])) return "rpm";
      if (await installed("pacman", ["-Q", "cloudflare-one-warp"])) return "arch";
      return "source";
    })();
  }
  return packageFormatProbe;
}

export function guidedCommands(format, { version, owner, repo, tag, arch = process.arch } = {}) {
  if (!isSafeGithubRef(owner || "") || !isSafeGithubRef(repo || "")) {
    return ["# Invalid update source; refusing to generate shell commands."];
  }
  if (tag && !isSafeTag(tag)) {
    return ["# Invalid release tag; refusing to generate shell commands."];
  }

  const v = version && /^[0-9A-Za-z.+-]+$/.test(String(version)) ? String(version) : "latest";
  const t = tag && isSafeTag(tag) ? tag : `v${v}`;
  const base = `https://github.com/${owner}/${repo}/releases/download/${t}`;

  if (["appimage", "snap", "flatpak"].includes(format) && arch !== "x64") {
    return ["# No compatible release bundle is published for this architecture. Check the releases page for an available build."];
  }

  const bundleNames = {
    deb: `cloudflare-one-warp_${v}_all.deb`,
    rpm: `cloudflare-one-warp-${v}-1.noarch.rpm`,
    arch: `cloudflare-one-warp-${v}-1-any.pkg.tar.zst`,
    flatpak: `cloudflare-one-warp-${v}-x86_64.flatpak`,
    snap: `cloudflare-one-warp_${v}_amd64.snap`
  };
  const assetName = bundleNames[format];
  if (assetName) {
    const file = `"$cloudflare_warp_update_dir/${assetName}"`;
    const install = {
      deb: `sudo dpkg -i ${file}`,
      rpm: `sudo rpm -Uvh ${file}`,
      arch: `sudo pacman -U ${file}`,
      flatpak: `flatpak install --user --reinstall --bundle ${file}`,
      snap: `sudo snap refresh --dangerous --classic ${file}`
    }[format];
    // The user copies one fail-closed shell block. Private staging prevents a
    // different local user from swapping a predictable /tmp package before sudo.
    return [
      "(",
      "  set -eu",
      "  umask 077",
      '  cloudflare_warp_update_dir="$(mktemp -d)"',
      `  trap 'rm -rf "$cloudflare_warp_update_dir"' EXIT`,
      `  curl -fsSL --proto '=https' --proto-redir '=https' -o ${file} "${base}/${assetName}"`,
      `  curl -fsSL --proto '=https' --proto-redir '=https' -o "$cloudflare_warp_update_dir/SHA256SUMS" "${base}/SHA256SUMS"`,
      `  cd "$cloudflare_warp_update_dir"`,
      `  awk -v name=${shellQuote(assetName)} '$2 == name || $2 == "*" name { print; found = 1 } END { if (!found) exit 1 }' SHA256SUMS > selected-checksum`,
      "  sha256sum --check --status selected-checksum",
      `  ${install}`,
      ")"
    ];
  }

  switch (format) {
    case "homebrew":
      return ["brew update", "brew upgrade cloudflare-one-warp || brew install cloudflare-one-warp"];
    case "appimage":
      return [`# Download ${base}/cloudflare-one-warp-${v}-x86_64.AppImage and replace your current AppImage`];
    default:
      return [
        "(",
        "  set -eu",
        "  umask 077",
        `  cloudflare_warp_update_dir="$(mktemp -d)"`,
        `  trap 'rm -rf "$cloudflare_warp_update_dir"' EXIT`,
        `  git clone --depth 1 --branch ${t} "https://github.com/${owner}/${repo}.git" "$cloudflare_warp_update_dir"`,
        `  npm --prefix "$cloudflare_warp_update_dir" ci --omit=dev --ignore-scripts`,
        `  bash "$cloudflare_warp_update_dir/scripts/install-local.sh" --install-dir ${shellQuote(installRoot)}`,
        ")",
        "# Restart Cloudflare One WARP after installation."
      ];
  }
}
