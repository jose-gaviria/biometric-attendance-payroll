import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkContinuity,
  continuityThreshold,
  initialLive,
  observe,
  pauseForInvalidFrame,
  type ChallengeType,
} from "./liveness.js";
const embedding = Array.from({ length: 128 }, (_, i) => +(i === 0));
function sequence(type: ChallengeType, values: [number, number][]) {
  const s = initialLive(0);
  values.forEach(([ear, yaw], i) =>
    observe(s, type, { ear, yaw, embedding, digest: String(i) }, 300 * i),
  );
  return s;
}
test("blink requires open-closed-open transition", () =>
  assert.equal(
    sequence("blink", [
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.12, 0],
      [0.12, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
    ]).stage,
    "passed",
  ));
test("closed eyes alone do not pass", () =>
  assert.equal(sequence("blink", Array(10).fill([0.1, 0])).stage, "baseline"));
test("static portrait does not pass", () =>
  assert.equal(sequence("blink", Array(10).fill([0.3, 0])).stage, "action"));
test("left requires baseline turn return", () =>
  assert.equal(
    sequence("left", [
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0.25],
      [0.3, 0.25],
      [0.3, 0.25],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
    ]).stage,
    "passed",
  ));
test("right requires baseline turn return", () =>
  assert.equal(
    sequence("right", [
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, -0.25],
      [0.3, -0.25],
      [0.3, -0.25],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
    ]).stage,
    "passed",
  ));
test("opposite turn fails", () =>
  assert.notEqual(
    sequence("left", [
      [0.3, 0],
      [0.3, 0],
      [0.3, -0.25],
      [0.3, -0.25],
      [0.3, 0],
      [0.3, 0],
    ]).stage,
    "passed",
  ));
test("starting already turned does not pass", () =>
  assert.equal(sequence("left", Array(10).fill([0.3, 0.3])).stage, "baseline"));
test("repeated encoded frame rejected", () => {
  const s = initialLive();
  const frame = { ear: 0.3, yaw: 0, embedding, digest: "same" };
  observe(s, "blink", frame);
  assert.throws(() => observe(s, "blink", frame), /repeated_frame/);
});
test("person swap rejected including after liveness", () => {
  const s = sequence("blink", [
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.12, 0],
    [0.12, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
    [0.3, 0],
  ]);
  assert.throws(
    () =>
      observe(s, "blink", {
        ear: 0.3,
        yaw: 0,
        digest: "new",
        embedding: Array.from({ length: 128 }, (_, i) => +(i === 1)),
      }),
    /person_changed/,
  );
});
test("the action instruction is visible before the action is evaluated", () => {
  const s = initialLive(0);
  for (let i = 0; i < 4; i++)
    observe(s, "blink", { ear: 0.3, yaw: 0, embedding, digest: `b${i}` }, i * 200);
  assert.equal(s.stage, "action");
  observe(s, "blink", { ear: 0.1, yaw: 0, embedding, digest: "early" }, 800);
  assert.equal(s.actionFrames, 0);
});
test("continuity tolerates moderate appearance variation such as glasses", () => {
  const s = initialLive();
  checkContinuity(s, { ear: 0.3, yaw: 0, embedding, digest: "anchor" });
  const glassesVariation = Array.from({ length: 128 }, (_, index) =>
    index === 0 ? 0.4 : index === 1 ? Math.sqrt(1 - 0.4 ** 2) : 0,
  );
  assert.doesNotThrow(() =>
    checkContinuity(
      s,
      {
        ear: 0.3,
        yaw: 0,
        embedding: glassesVariation,
        digest: "glasses",
      },
      continuityThreshold(0.5),
    ),
  );
});
test("continuity still rejects an unrelated face", () => {
  const s = initialLive();
  checkContinuity(s, { ear: 0.3, yaw: 0, embedding, digest: "anchor" });
  const unrelated = Array.from({ length: 128 }, (_, index) => +(index === 1));
  assert.throws(
    () =>
      checkContinuity(
        s,
        { ear: 0.3, yaw: 0, embedding: unrelated, digest: "unrelated" },
        continuityThreshold(0.5),
      ),
    /person_changed/,
  );
});
test("an invalid frame restarts the current instruction hold", () => {
  const s = initialLive(0);
  for (let i = 0; i < 4; i++)
    observe(s, "left", { ear: 0.3, yaw: 0, embedding, digest: `q${i}` }, i * 200);
  assert.equal(s.stage, "action");
  pauseForInvalidFrame(s, 1500);
  observe(
    s,
    "left",
    { ear: 0.3, yaw: 0.3, embedding, digest: "too-soon" },
    2000,
  );
  assert.equal(s.actionFrames, 0);
});
