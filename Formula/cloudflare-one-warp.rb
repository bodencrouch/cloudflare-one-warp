class CloudflareOneWarp < Formula
  desc "Cloudflare One WARP — unofficial Cloudflare One client via warp-cli"
  homepage "https://github.com/bodencrouch/cloudflare-one-warp"
  url "https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v0.3.2/cloudflare-one-warp-0.3.2-src.tar.gz"
  sha256 "b57f5f579cb0b781362967a1a18dec01a312ad83c0b0f34f46e62e41eaa47687"
  license "MIT"

  depends_on "node@20"

  def install
    libexec.install "server.js", "package.json", "lib", "config", "public", "assets", "scripts", "bin", "LICENSE", "README.md"
    (bin/"cloudflare-one-warp").write <<~EOS
      #!/bin/bash
      export PATH="#{Formula["node@20"].bin}:$PATH"
      exec "#{libexec}/bin/cloudflare-one-warp" "$@"
    EOS
    chmod 0755, bin/"cloudflare-one-warp"
  end

  def caveats
    <<~EOS
      Requires Cloudflare WARP (warp-cli) installed separately on macOS.
      Launch with: cloudflare-one-warp --no-open
    EOS
  end

  test do
    assert_match "Cloudflare One WARP", shell_output("#{bin}/cloudflare-one-warp --help")
  end
end
