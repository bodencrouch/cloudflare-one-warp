Name:           cloudflare-one-warp
Version:        0.3.6
Release:        1%{?dist}
Summary:        Cloudflare One WARP — unofficial Cloudflare One client via warp-cli

License:        MIT
URL:            https://github.com/bodencrouch/cloudflare-one-warp
Source0:        https://github.com/bodencrouch/cloudflare-one-warp/releases/download/v%{version}/cloudflare-one-warp-%{version}-src.tar.gz

BuildArch:      noarch
BuildRequires:  nodejs >= 22
BuildRequires:  bash
Requires:       nodejs >= 22
Recommends:     python3-pyqt6, python3-pyqt6-webengine, yad, libnotify

%description
Cloudflare One WARP wraps the host Cloudflare WARP client (warp-cli) with a local
HTTP API and optional browser UI. Requires Cloudflare WARP on the host.

%prep
%autosetup -c -n %{name}-%{version}

%build
# JavaScript payload — no compile step

%install
PAYLOAD_DIR="%{buildroot}" PACKAGE_VERSION="%{version}" bash packaging/scripts/stage-payload.sh

%files
/usr/bin/cloudflare-one-warp
/usr/bin/cloudflare-one-warp-gui
/usr/bin/cloudflare-one-warp-tray
/usr/lib/cloudflare-one-warp/
/usr/share/applications/cloudflare-one-warp*.desktop
/usr/share/polkit-1/actions/com.cloudflare.one.warp.policy
/usr/share/icons/hicolor/scalable/apps/cloudflare-one-warp.svg
/usr/lib/systemd/user/cloudflare-one-warp.service
/usr/share/licenses/cloudflare-one-warp/LICENSE
/usr/share/doc/cloudflare-one-warp/README.md

/etc/default/cloudflare-one-warp
/etc/cloudflare-one-warp/config.json.example
/etc/NetworkManager/dispatcher.d/99-cloudflare-one-warp
/etc/sysctl.d/99-cloudflare-one-warp.conf
/usr/share/cloudflare-one-warp/
/usr/share/doc/cloudflare-one-warp/CHANGELOG.md
/usr/share/doc/cloudflare-one-warp/SECURITY.md

%post
legacy_vpn=/usr/lib/NetworkManager/VPN/nm-cloudflare-one-warp-service.name
if [ -f "$legacy_vpn" ] && [ ! -L "$legacy_vpn" ] &&
   grep -Fxq 'name=Cloudflare One WARP' "$legacy_vpn" &&
   grep -Fxq 'service=org.cloudflare.one.warp' "$legacy_vpn"; then
  rm -f "$legacy_vpn"
fi

%changelog
* Sat Jul 18 2026 Cloudflare One WARP contributors - %{version}-1
- Release %{version}
