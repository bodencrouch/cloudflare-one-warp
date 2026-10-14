import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const helpers = ['daemon-ready.mjs', 'health-webui-check.mjs', 'webui-handoff.mjs', 'proxy-launcher-cleanup.mjs', 'tray-shell-cli.mjs', 'tray-settings.py', 'tray_api.py', 'tray_workers.py'];
function filesBelow(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? filesBelow(join(directory, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]);
}
for (const recipe of ['packaging/arch/PKGBUILD.in', 'packaging/aur/PKGBUILD', 'packaging/fedora/cloudflare-one-warp.spec']) {
  test(`${recipe} actually stages the complete runnable payload`, { skip: process.platform !== 'linux' }, () => {
    const destination = mkdtempSync(join(tmpdir(), 'warp-recipe-'));
    try {
      const source = readFileSync(join(root, recipe), 'utf8');
      const command = recipe.endsWith('.spec')
        ? source.split('%install\n')[1].split('\n%files')[0].replaceAll('%{buildroot}', destination).replaceAll('%{version}', packageVersion)
        : 'source "$RECIPE"; package';
      const result = spawnSync('bash', ['-euc', command], { cwd: root, encoding: 'utf8', env: { ...process.env, RECIPE: join(root, recipe), pkgdir: destination, srcdir: root, pkgver: packageVersion } });
      assert.equal(result.status, 0, result.stderr);
      const payload = join(destination, 'usr/lib/cloudflare-one-warp');
      for (const file of helpers) assert.ok(existsSync(join(payload, 'scripts', file)), `${recipe} omits ${file}`);
      for (const file of filesBelow(join(root, 'lib'))) assert.ok(existsSync(join(payload, 'lib', file)), `${recipe} omits lib/${file}`);
      const launcher = spawnSync('bash', [join(payload, 'bin/cloudflare-one-warp'), '--version'], { encoding: 'utf8' });
      assert.equal(launcher.status, 0, launcher.stderr);
      assert.ok(launcher.stdout.includes(packageVersion), launcher.stdout);
      const shell = spawnSync(process.execPath, [join(payload, 'scripts/tray-shell-cli.mjs'), 'active'], { encoding: 'utf8', env: { ...process.env, HOME: destination, XDG_CONFIG_HOME: join(destination, 'config'), CLOUDFLARE_ONE_WARP_HOME: payload } });
      assert.equal(shell.status, 0, shell.stderr);
      assert.ok(existsSync(join(destination, 'usr/bin/cloudflare-one-warp-gui')));
      assert.ok(existsSync(join(destination, 'usr/share/applications/cloudflare-one-warp-settings.desktop')));
    } finally { rmSync(destination, { recursive: true, force: true }); }
  });
}

test('service prepares integration paths before confinement and isolates temporary files', () => {
  const packaged = readFileSync(join(root, 'packaging/cloudflare-one-warp.service'), 'utf8');
  const installer = readFileSync(join(root, 'scripts/install-local.sh'), 'utf8');
  for (const unit of [packaged, installer]) {
    assert.match(unit, /RuntimeDirectory=cloudflare-one-warp/);
    assert.match(unit, /Environment=TMPDIR=%t\/cloudflare-one-warp/);
    assert.match(unit, /ExecStartPre=\+\/usr\/bin\/mkdir -p .*(?:proxy-launchers|PROXY_PATH)/);
    assert.match(unit, /ProtectSystem=strict/);
    assert.doesNotMatch(unit, /ReadWritePaths=.*(?:\s-?\/tmp(?:\s|$)|\s-?%h(?:\s|$))/);
  }
  assert.match(packaged, /%E\/systemd\/user/);
  assert.match(installer, /Environment=\$\{CONFIG_ENV\}/);
  assert.match(installer, /Environment=\$\{DATA_ENV\}/);
});
