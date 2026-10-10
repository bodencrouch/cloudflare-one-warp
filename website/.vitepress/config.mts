import { defineConfig } from "vitepress";

const repository = process.env.GITHUB_REPOSITORY || "bodencrouch/cloudflare-one-warp";
const base = `/${repository.split("/").at(-1)}/`;

export default defineConfig({
  title: "Cloudflare One WARP",
  description: "Unofficial Cloudflare One client — CLI, API, tray, and Web UI for warp-cli",
  lang: "en-US",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: `${base}favicon.svg`, type: "image/svg+xml" }]
  ],
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Cloudflare One WARP",
    nav: [
      { text: "Install", link: "/install/" },
      { text: "CLI", link: "/cli/" },
      { text: "Guides", link: "/guides/" },
      { text: "API", link: "/api/" },
      { text: "Config", link: "/configuration/" },
      {
        text: "More",
        items: [
          { text: "Packaging", link: "/packaging/" },
          { text: "Troubleshooting", link: "/troubleshooting/" },
          { text: "Contributing", link: "/contributing/" },
          { text: "GitHub", link: "https://github.com/bodencrouch/cloudflare-one-warp" }
        ]
      }
    ],
    sidebar: {
      "/install/": [
        {
          text: "Install",
          items: [
            { text: "Overview", link: "/install/" },
            { text: "Quick install", link: "/install/quick" },
            { text: "User install", link: "/install/local" },
            { text: "Distribution channels", link: "/install/channels" },
            { text: "Verify install", link: "/install/verify" }
          ]
        }
      ],
      "/cli/": [
        {
          text: "CLI reference",
          items: [
            { text: "Overview", link: "/cli/" },
            { text: "cloudflare-one-warp", link: "/cli/cloudflare-one-warp" },
            { text: "cloudflare-one-warp operator", link: "/cli/operator" },
            { text: "Tray", link: "/cli/tray" },
            { text: "Helper scripts", link: "/cli/helpers" },
            { text: "npm scripts", link: "/cli/npm" }
          ]
        }
      ],
      "/guides/": [
        {
          text: "Guides",
          items: [
            { text: "Overview", link: "/guides/" },
            { text: "First connection", link: "/guides/first-connection" },
            { text: "Web UI", link: "/guides/web-ui" },
            { text: "Native tray (KDE)", link: "/guides/tray" },
            { text: "Kill switch", link: "/guides/kill-switch" },
            { text: "Split tunnel & app routing", link: "/guides/routing" },
            { text: "KDE / NetworkManager", link: "/guides/networkmanager" },
            { text: "WARP internals", link: "/guides/warp-internals" },
            { text: "Updates", link: "/guides/updates" },
            { text: "systemd daemon", link: "/guides/systemd" }
          ]
        }
      ],
      "/api/": [
        {
          text: "HTTP API",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "Endpoints", link: "/api/endpoints" },
            { text: "Actions catalog", link: "/api/actions" },
            { text: "curl cookbook", link: "/api/cookbook" },
            { text: "OpenAPI", link: "/api/openapi" }
          ]
        }
      ],
      "/configuration/": [
        {
          text: "Configuration",
          items: [
            { text: "Overview", link: "/configuration/" },
            { text: "Config keys", link: "/configuration/keys" },
            { text: "Environment variables", link: "/configuration/env" }
          ]
        }
      ],
      "/packaging/": [{ text: "Packaging", link: "/packaging/" }],
      "/troubleshooting/": [{ text: "Troubleshooting", link: "/troubleshooting/" }],
      "/contributing/": [{ text: "Contributing", link: "/contributing/" }]
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/bodencrouch/cloudflare-one-warp" }
    ],
    footer: {
      message: "Unofficial client — not affiliated with Cloudflare.",
      copyright: "Cloudflare One WARP contributors · MIT"
    },
    search: { provider: "local" }
  }
});
