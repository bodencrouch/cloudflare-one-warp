Name:           cloudflare-one-warp
Version:        %{version}
Release:        1%{?dist}
Summary:        Cloudflare One WARP — unofficial Cloudflare One client via warp-cli

License:        MIT
URL:            https://github.com/bodencrouch/cloudflare-one-warp
Source0:        https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v%{version}/cloudflare-one-warp-%{version}-src.tar.gz

BuildArch:      noarch
Requires:       nodejs >= 20
Recommends:     python3-pyqt6, python3-pyqt6-webengine, yad, libnotify

%description
Cloudflare One WARP wraps the host Cloudflare WARP client (warp-cli) with a local
HTTP API and optional browser UI. Requires Cloudflare WARP on the host.

%prep
%autosetup -n .

%build
# JavaScript payload — no compile step

%install
rm -rf %{buildroot}
install -d %{buildroot}/usr/lib/cloudflare-one-warp
install -m 0644 server.js package.json %{buildroot}/usr/lib/cloudflare-one-warp/
cp -a public assets lib config %{buildroot}/usr/lib/cloudflare-one-warp/
install -d %{buildroot}/usr/lib/cloudflare-one-warp/scripts %{buildroot}/usr/lib/cloudflare-one-warp/bin
install -m 0755 scripts/health-check.mjs scripts/port-open.mjs scripts/cloudflare-one-warp-nft-apply \
  scripts/tray-qt.py scripts/tray-sni.py scripts/tray_api.py scripts/tray-warp-action.py \
  %{buildroot}/usr/lib/cloudflare-one-warp/scripts/
install -m 0755 bin/cloudflare-one-warp bin/cloudflare-one-warp-tray bin/cloudflare-one-warp-gui bin/cloudflare-one-warp-tray \
  %{buildroot}/usr/lib/cloudflare-one-warp/bin/
install -d %{buildroot}/usr/bin
install -m 0755 packaging/usr-bin-wrapper.sh %{buildroot}/usr/bin/cloudflare-one-warp
install -m 0755 packaging/usr-bin-alias-wrapper.sh %{buildroot}/usr/bin/cloudflare-one-warp
install -m 0755 packaging/usr-bin-tray-wrapper.sh %{buildroot}/usr/bin/cloudflare-one-warp-tray
install -d %{buildroot}/usr/share/polkit-1/actions
install -m 0644 packaging/polkit/com.cloudflare.one.warp.policy \
  %{buildroot}/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy
install -d %{buildroot}/usr/share/applications
install -m 0644 packaging/cloudflare-one-warp.desktop %{buildroot}/usr/share/applications/cloudflare-one-warp.desktop
install -m 0644 packaging/cloudflare-one-warp-tray.desktop %{buildroot}/usr/share/applications/cloudflare-one-warp-tray.desktop
install -d %{buildroot}/usr/share/icons/hicolor/scalable/apps
install -m 0644 assets/cloudflare-one-warp.svg %{buildroot}/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg
install -d %{buildroot}/usr/lib/systemd/user
install -m 0644 packaging/cloudflare-one-warp.service %{buildroot}/usr/lib/systemd/user/cloudflare-one-warp.service
install -d %{buildroot}/usr/share/licenses/cloudflare-one-warp
install -m 0644 LICENSE %{buildroot}/usr/share/licenses/cloudflare-one-warp/LICENSE
install -d %{buildroot}/usr/share/doc/cloudflare-one-warp
install -m 0644 README.md %{buildroot}/usr/share/doc/cloudflare-one-warp/README.md

%files
/usr/bin/cloudflare-one-warp
/usr/bin/cloudflare-one-warp
/usr/bin/cloudflare-one-warp-tray
/usr/lib/cloudflare-one-warp/
/usr/share/applications/cloudflare-one-warp.desktop
/usr/share/applications/cloudflare-one-warp-tray.desktop
/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy
/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg
/usr/lib/systemd/user/cloudflare-one-warp.service
/usr/share/licenses/cloudflare-one-warp/LICENSE
/usr/share/doc/cloudflare-one-warp/README.md

%changelog
* Sat Jul 18 2026 Cloudflare One WARP contributors - %{version}-1
- Release %{version}
