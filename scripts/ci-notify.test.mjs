import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  notificationForTransition,
  parseStatus,
  statusFingerprint
} from "../lib/warp/status.mjs";
import { sendDesktopNotification } from "../lib/notify/desktop.mjs";
import { startStatusWatcher } from "../lib/notify/status-watcher.mjs";

test("parseStatus detects connected and disconnected", () => {
  const connected = parseStatus("Status update: Connected\nNetwork: Healthy");
  assert.equal(connected.connected, true);
  assert.equal(connected.severity, "good");

  const disconnected = parseStatus("Status update: Disconnected");
  assert.equal(disconnected.disconnected, true);
  assert.equal(disconnected.connected, false);
});

test("notificationForTransition suppresses Connected→Connecting roam flaps", () => {
  const connected = parseStatus("Status update: Connected\nNetwork: Healthy");
  const connecting = parseStatus("Status update: Connecting");
  assert.equal(notificationForTransition(connected, connecting), null);
});

test("notificationForTransition suppresses bootstrap and duplicates", () => {
  const a = parseStatus("Status update: Disconnected");
  const b = parseStatus("Status update: Connected");
  assert.equal(notificationForTransition(null, a), null);
  assert.equal(notificationForTransition(a, a), null);

  const note = notificationForTransition(a, b);
  assert.ok(note);
  assert.match(note.body, /Connected/i);
  assert.equal(note.kind, "connect_success");

  const down = notificationForTransition(b, a);
  assert.ok(down);
  assert.match(down.body, /Disconnected/i);
  assert.equal(down.kind, "unexpected_disconnect");
});

test("Always On disconnect uses a needs-attention notification", () => {
  const connected = parseStatus("Status update: Connected");
  const disconnected = parseStatus("Status update: Disconnected");
  const note = notificationForTransition(connected, disconnected, { killSwitchDesired: true });
  assert.ok(note);
  assert.equal(note.kind, "needs_attention");
  assert.match(note.body, /Always On/i);
});

test("statusFingerprint ignores label-only changes", () => {
  const a = parseStatus("Status update: Connected");
  const b = parseStatus("Status update: Connected\nReason: still up");
  assert.equal(statusFingerprint(a), statusFingerprint(b));
});

test("sendDesktopNotification spawns notify-send with argv only", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "tf-notify-"));
  const bin = join(dir, "notify-send");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);

  const calls = [];
  const fakeSpawn = (path, args, opts) => {
    calls.push({ path, args, opts });
    return { unref() {} };
  };
  try {
    const result = sendDesktopNotification(
      { title: "ThirdFlare One", body: "Connected" },
      {
        env: { PATH: dir, DISPLAY: ":0" },
        spawnImpl: fakeSpawn,
        root: dir
      }
    );
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, bin);
    assert.ok(calls[0].args.includes("ThirdFlare One"));
    assert.ok(calls[0].args.includes("Connected"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status watcher notifies on debounced connect transition", async () => {
  const notes = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};

  const watcher = startStatusWatcher({
    spawnWarpCli: () => child,
    enabled: true,
    debounceMs: 20,
    available: () => true,
    notify: (note) => notes.push(note),
    env: { PATH: "/usr/bin", DISPLAY: ":0" }
  });
  assert.equal(watcher.started, true);

  child.stdout.emit("data", Buffer.from("Status update: Disconnected\n"));
  await new Promise((r) => setTimeout(r, 40));
  child.stdout.emit("data", Buffer.from("Status update: Connected\n"));
  await new Promise((r) => setTimeout(r, 40));

  watcher.stop();
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /Connected/i);
});

test("status watcher respects enabled=false", () => {
  const watcher = startStatusWatcher({
    spawnWarpCli: () => {
      throw new Error("should not spawn");
    },
    enabled: false,
    available: () => true
  });
  assert.equal(watcher.started, false);
  assert.equal(watcher.reason, "disabled");
});
