# Security policy

Cloudflare One WARP is an independent client that controls an installed official Cloudflare WARP client. Security fixes target the latest release. Upgrade before reporting behavior already corrected in a newer version.

## Report a vulnerability privately

Private vulnerability reporting is not enabled on this repository. To request a private reporting channel, open a minimal [GitHub issue](https://github.com/bodencrouch/cloudflare-one-warp/issues/new) containing no exploit details, credentials or personal account information. After a private channel is established, include affected versions, operating system, prerequisites, reproduction steps and expected versus observed behavior. No response-time guarantee or bounty program is offered.

## Trust boundaries

The Node daemon runs as the desktop user and listens only on loopback. Every private API request requires a random credential from an owner-readable mode-0600 file; health and version expose limited public metadata. Host validation and browser origin checks further restrict requests. Credentials do not bypass operating-system or Cloudflare policy.

The optional browser UI starts through a private HTML handoff, transfers its credential in a URL fragment, saves it in tab session storage and immediately clears the fragment. Native clients read the private file. The HTTP session endpoint cannot bootstrap an unauthenticated client. Never share handoff files, token files, browser storage, or authorization headers.

Same-user malicious software, browser extensions able to inspect the UI, root, a compromised official WARP binary, and compromised operating-system permissions are outside this credential boundary. There is no telemetry upload; review diagnostic output before sharing it.

The Linux firewall helper constructs fixed rules for its own nftables table and accepts structured options rather than arbitrary scripts. Enrollment can temporarily pause the kill switch; the UI exposes this state and failed restoration. The kill switch permits documented tunnel bootstrap and limited link-local network control. It is not a substitute for an organization's Cloudflare device policy.

Desktop integration owns addressless NetworkManager marker interfaces and journals KDE proxy changes. It must not reconfigure the vendor tunnel or overwrite existing managed desktop proxy policy.

AppImage replacement requires a detached signature matching a pinned release key. A checksum alone does not authorize installation. The shipped trusted-key ring is empty, so automatic AppImage replacement remains unavailable; download releases manually. Release provenance and application-dependency SBOMs supplement supply-chain inspection but do not certify every bundled runtime, operating-system dependency or native platform.

## Validation limits

Cross-platform mock tests validate the control plane. Linux firewall and desktop integration tests use isolated fakes unless explicitly described as native checks. An optional real-WARP CI run is not universal native certification. macOS notarization, Windows code signing and production tunnel coverage require their own platform-specific release evidence.
