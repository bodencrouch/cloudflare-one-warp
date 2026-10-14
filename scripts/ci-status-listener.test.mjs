import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createStatusListener } from "../lib/warp/status-listener.mjs";

test("status listener shares one warp-cli child across subscribers", () => {
  let spawnCount = 0;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};

  const listener = createStatusListener({
    spawnWarpCli: () => {
      spawnCount += 1;
      return child;
    },
    restartDelayMs: 5000
  });

  const lines = [];
  const unsubA = listener.subscribe((payload) => lines.push(payload.line));
  const unsubB = listener.subscribe(() => {});
  assert.equal(spawnCount, 1);
  assert.equal(listener.subscriberCount, 2);

  child.stdout.emit("data", Buffer.from("Status update: Connected\n"));
  assert.equal(lines.length, 1);

  unsubA();
  assert.equal(spawnCount, 1);
  assert.equal(listener.listenerActive, true);

  unsubB();
  assert.equal(listener.subscriberCount, 0);
  assert.equal(listener.listenerActive, false);
});

test("status listener restarts child after exit when subscribers remain", async () => {
  let spawnCount = 0;
  let child = null;

  const listener = createStatusListener({
    spawnWarpCli: () => {
      spawnCount += 1;
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => child.emit("close", 0);
      return child;
    },
    restartDelayMs: 30
  });

  const unsub = listener.subscribe(() => {});
  assert.equal(spawnCount, 1);
  child.emit("close", 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(spawnCount, 2);
  unsub();
  listener.stop();
});

test("late close/data from previous child do not affect a replacement", async () => {
  const children = [];
  const listener = createStatusListener({ spawnWarpCli: () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
    children.push(proc); return proc;
  }, restartDelayMs: 5 });
  const unsubscribe = listener.subscribe(() => {});
  unsubscribe();
  const lines = [];
  listener.subscribe((payload) => lines.push(payload.line));
  children[0].stdout.emit("data", Buffer.from("stale\n"));
  children[0].emit("close", 0);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(children.length, 2);
  assert.equal(listener.listenerActive, true);
  assert.deepEqual(lines, []);
  listener.stop();
});

test("synchronous spawn failure is reported and retried without breaking subscribe", async () => {
  let count = 0;
  const lines = [];
  const proc = new EventEmitter();
  proc.kill = () => {};
  const listener = createStatusListener({ spawnWarpCli() {
    if (++count === 1) throw new Error("spawn unavailable");
    return proc;
  }, restartDelayMs: 5 });
  listener.subscribe(payload => lines.push(payload.line));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(lines, ["spawn unavailable"]);
  assert.equal(listener.listenerActive, true);
  listener.stop();
  listener.subscribe(() => {});
  assert.equal(listener.subscriberCount, 0);
});
