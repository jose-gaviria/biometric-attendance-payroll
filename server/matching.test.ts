import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identify,
  cosine,
  possibleDuplicate,
  vectorValid,
  type Candidate,
} from "./matching.js";
import { calibration } from "../scripts/calibrate-face-threshold.js";
const unit = (index: number) =>
  Array.from({ length: 128 }, (_, i) => +(i === index));
const people: Candidate[] = [
  { id: "a", name: "Persona A", vectors: [unit(0), unit(0)] },
  { id: "b", name: "Persona B", vectors: [unit(1), unit(1)] },
];
test("1:N identifies among multiple profiles using four normalized queries", () => {
  const r = identify(Array(4).fill(unit(1)), people, 0.5, 0.08);
  assert.equal(r.name, "Persona B");
  assert.equal(r.accepted, true);
  assert.equal(r.second_score, 0);
});
test("unknown is rejected even when gallery is nonempty", () =>
  assert.equal(
    identify(Array(4).fill(unit(2)), people, 0.5, 0.08).reason,
    "unknown",
  ));
test("empty gallery rejects", () =>
  assert.equal(
    identify(Array(4).fill(unit(0)), [], 0.5, 0.08).reason,
    "unknown",
  ));
test("top 1 and top 2 close is ambiguous", () => {
  const query = unit(0).map((_, i) => (i < 2 ? Math.SQRT1_2 : 0));
  assert.equal(
    identify(Array(4).fill(query), people, 0.5, 0.08).reason,
    "ambiguous",
  );
});
test("threshold is enforced and configurable", () => {
  const q = unit(0).map((_, i) => (i === 0 ? 0.6 : i === 2 ? 0.8 : 0));
  assert.equal(identify(Array(4).fill(q), people, 0.61, 0.08).accepted, false);
  assert.equal(identify(Array(4).fill(q), people, 0.59, 0.08).accepted, true);
});
test("inconsistent frames cannot be hidden by median", () =>
  assert.equal(
    identify([unit(0), unit(0), unit(0), unit(1)], people, 0.5, 0.08).reason,
    "inconsistent",
  ));
test("one frame is never enough", () =>
  assert.throws(() => identify([unit(0)], people, 0.5, 0.08)));
test("invalid dimensions and NaN are rejected", () => {
  assert.equal(vectorValid([1, 0]), false);
  assert.equal(vectorValid(unit(0).map(() => NaN)), false);
  assert.equal(vectorValid(unit(0).map(() => 1)), false);
});
test("duplicate prevention considers other profiles", () =>
  assert.equal(possibleDuplicate([unit(0)], people, 0.55), true));
test("unrelated face is not duplicate", () =>
  assert.equal(possibleDuplicate([unit(2)], people, 0.55), false));
test("cosine normalized vectors range", () => {
  assert.equal(cosine(unit(0), unit(0)), 1);
  assert.equal(cosine(unit(0), unit(1)), 0);
});
test("calibration refuses insufficient data", () =>
  assert.equal(calibration([people[0]]).suggested_threshold, null));
test("calibration produces genuine impostor and leave-one-out trials", () => {
  const r = calibration(people);
  assert.equal(r.genuine?.min, 1);
  assert.equal(r.impostor?.max, 0);
  assert.equal(r.trials.length, 4);
  assert.equal(r.suggested_threshold, 0.5);
});
