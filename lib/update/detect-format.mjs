import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const installRoot = fileURLToPath(new URL("../../", import.meta.url));
const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";

const SAFE_REF = /^[A-Za-z0-9._-]+$/;
const SAFE_TAG = /^v?[0-9A-Za-z._-]+$/;

export function isSafeGithubRef(value) {
  return typeof value === "string" && SAFE_REF.test(value) && value.length <= 100;
}

export function isSafeTag(value) {
  return typeof value === "string" && SAFE_TAG.test(value) && value.length <= 64;
}

/**
 * Detect how Cloudflare One WARP was installed.
 * Override with CLOUDFLARE_ONE_WARP_INSTALL_FORMAT=appimage|deb|rpm|arch|flatpak|snap|homebrew|source
 */
export function detectInstallFormat(env = process.env) {
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

  switch (format) {
    case "deb":
      return [
        `curl -fsSL -o /tmp/cloudflare-one-warp_${v}_all.deb "${base}/cloudflare-one-warp_${v}_all.deb"`,
        `sudo dpkg -i /tmp/cloudflare-one-warp_${v}_all.deb`
      ];
    case "rpm":
      return [
        `curl -fsSL -o /tmp/cloudflare-one-warp-${v}-1.noarch.rpm "${base}/cloudflare-one-warp-${v}-1.noarch.rpm"`,
        `sudo rpm -Uvh /tmp/cloudflare-one-warp-${v}-1.noarch.rpm`
      ];
    case "arch":
      return [
        `curl -fsSL -o /tmp/cloudflare-one-warp-${v}-1-any.pkg.tar.zst "${base}/cloudflare-one-warp-${v}-1-any.pkg.tar.zst"`,
        `sudo pacman -U /tmp/cloudflare-one-warp-${v}-1-any.pkg.tar.zst`
      ];
    case "homebrew":
      return ["brew update", "brew upgrade cloudflare-one-warp || brew install cloudflare-one-warp"];
    case "flatpak":
      return [
        `curl -fsSL -o /tmp/cloudflare-one-warp-${v}-x86_64.flatpak "${base}/cloudflare-one-warp-${v}-x86_64.flatpak"`,
        `flatpak install --user --reinstall --bundle /tmp/cloudflare-one-warp-${v}-x86_64.flatpak`
      ];
    case "snap":
      return [
        `curl -fsSL -o /tmp/cloudflare-one-warp_${v}_amd64.snap "${base}/cloudflare-one-warp_${v}_amd64.snap"`,
        `sudo snap refresh --dangerous --classic /tmp/cloudflare-one-warp_${v}_amd64.snap`
      ];
    case "appimage":
      return [`# Download ${base}/cloudflare-one-warp-${v}-x86_64.AppImage and replace your current AppImage`];
    default:
      return [
        `cloudflare_warp_update_dir="$(mktemp -d)"`,
        `git clone --depth 1 --branch ${t} "https://github.com/${owner}/${repo}.git" "$cloudflare_warp_update_dir"`,
        `npm --prefix "$cloudflare_warp_update_dir" ci --omit=dev`,
        `bash "$cloudflare_warp_update_dir/scripts/install-local.sh" --install-dir ${shellQuote(installRoot)}`,
        `rm -rf "$cloudflare_warp_update_dir"`,
        "# Restart Cloudflare One WARP after installation."
      ];
  }
}
