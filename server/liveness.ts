import { cosine, type Vector } from "./matching.js";
export type ChallengeType = "blink" | "left" | "right";
export type Observation = {
  ear: number;
  yaw: number;
  embedding: Vector;
  digest: string;
};
export type LiveState = {
  stage: "baseline" | "action" | "return" | "passed";
  baseline: number[];
  baselineYaw: number[];
  actionFrames: number;
  returnFrames: number;
  anchor?: Vector;
  digests: Set<string>;
  started: number;
  baselineStartedAt?: number;
  stageChangedAt: number;
  passedAt?: number;
};
export const BASELINE_MIN_MS = 600;
export const ACTION_INSTRUCTION_MS = 1400;
export const RETURN_INSTRUCTION_MS = 1200;
export const PASSED_INSTRUCTION_MS = 1200;
// Continuity compares consecutive captures from the same short attempt; it is
// not the identity decision. Glasses, glare and head movement can move a valid
// SFace vector farther than the stricter gallery match threshold, so keep this
// guard deliberately lower while still rejecting unrelated vectors. Final
// identification continues to use the configured match threshold and margin.
export const continuityThreshold = (matchThreshold: number) =>
  Math.max(0.34, Math.min(0.5, matchThreshold - 0.14));
export function initialLive(now = Date.now()): LiveState {
  return {
    stage: "baseline",
    baseline: [],
    baselineYaw: [],
    actionFrames: 0,
    returnFrames: 0,
    digests: new Set(),
    started: now,
    stageChangedAt: now,
  };
}
export function pauseForInvalidFrame(state: LiveState, now = Date.now()) {
  if (state.stage === "baseline") {
    state.baseline = [];
    state.baselineYaw = [];
    state.baselineStartedAt = undefined;
  } else if (state.stage === "action") {
    state.actionFrames = 0;
    state.stageChangedAt = now;
  } else if (state.stage === "return") {
    state.returnFrames = 0;
    state.stageChangedAt = now;
  }
}
export function checkContinuity(
  state: LiveState,
  frame: Observation,
  threshold = 0.48,
) {
  if (state.digests.has(frame.digest)) throw new Error("repeated_frame");
  state.digests.add(frame.digest);
  if (state.anchor && cosine(state.anchor, frame.embedding) < threshold)
    throw new Error("person_changed");
  state.anchor ??= frame.embedding;
}
export function observe(
  state: LiveState,
  type: ChallengeType,
  frame: Observation,
  now = Date.now(),
  threshold = 0.48,
) {
  checkContinuity(state, frame, threshold);
  if (state.stage === "passed") return;
  if (state.stage === "baseline") {
    if (Math.abs(frame.yaw) < 0.12 && frame.ear > 0.2) {
      state.baselineStartedAt ??= now;
      state.baseline.push(frame.ear);
      state.baselineYaw.push(frame.yaw);
    } else {
      state.baseline = [];
      state.baselineYaw = [];
      state.baselineStartedAt = undefined;
    }
    if (
      state.baseline.length >= 4 &&
      now - (state.baselineStartedAt ?? now) >= BASELINE_MIN_MS
    ) {
      state.stage = "action";
      state.stageChangedAt = now;
    }
    return;
  }
  const open =
    state.baseline.reduce((a, b) => a + b, 0) / state.baseline.length;
  const origin =
    state.baselineYaw.reduce((a, b) => a + b, 0) / state.baselineYaw.length;
  if (state.stage === "action") {
    if (now - state.stageChangedAt < ACTION_INSTRUCTION_MS) return;
    const action =
      type === "blink"
        ? frame.ear < Math.min(0.17, open * 0.65)
        : type === "left"
          ? frame.yaw - origin > 0.18
          : frame.yaw - origin < -0.18;
    state.actionFrames = action ? state.actionFrames + 1 : 0;
    if (state.actionFrames >= (type === "blink" ? 2 : 3)) {
      state.stage = "return";
      state.stageChangedAt = now;
    }
  } else if (state.stage === "return") {
    if (now - state.stageChangedAt < RETURN_INSTRUCTION_MS) return;
    state.returnFrames =
      frame.ear > open * 0.8 && Math.abs(frame.yaw - origin) < 0.12
        ? state.returnFrames + 1
        : 0;
    if (state.returnFrames >= 3 && now - state.started >= 2400) {
      state.stage = "passed";
      state.passedAt = now;
      state.stageChangedAt = now;
    }
  }
}
