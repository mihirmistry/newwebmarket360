import assert from "node:assert/strict";
import { test } from "node:test";
import { alertShares, donutSegments, scaleOffset } from "../src/shared/format.js";
import { calculateSentiment, countAlerts, directionOf, formatPercent, formatSentiment, formatSignal } from "../src/shared/sentiment.js";

test("spec example: +2, +1, +2, +1, -2, -1 gives +33% Bullish", () => {
  const s = calculateSentiment([2, 1, 2, 1, -2, -1]);
  assert.equal(s.bullishStrength, 6);
  assert.equal(s.bearishStrength, 3);
  assert.equal(s.netStrength, 3);
  assert.equal(s.totalStrength, 9);
  assert.ok(Math.abs(s.percentExact - 33.333) < 0.01);
  assert.equal(s.percent, 33);
  assert.equal(s.label, "Bullish");
  assert.equal(formatSentiment(s), "+33% — Bullish");
});

test("no alerts or all-zero alerts are neutral at 0%", () => {
  for (const values of [[], [0, 0, 0]]) {
    const s = calculateSentiment(values);
    assert.equal(s.totalStrength, 0);
    assert.equal(s.percent, 0);
    assert.equal(s.label, "Neutral");
    assert.equal(formatSentiment(s), "0% — Neutral");
  }
});

test("balanced signals are neutral", () => {
  const s = calculateSentiment([2, -1, -1, 0]);
  assert.equal(s.netStrength, 0);
  assert.equal(s.percent, 0);
  assert.equal(s.label, "Neutral");
});

test("all bearish signals give -100% Bearish", () => {
  const s = calculateSentiment([-1, -2]);
  assert.equal(s.percent, -100);
  assert.equal(s.label, "Bearish");
  assert.equal(formatPercent(s.percent), "−100%");
});

test("bearish majority", () => {
  const s = calculateSentiment([1, -2, -1]); // B=1 D=3 N=-2 T=4 => -50%
  assert.equal(s.percent, -50);
  assert.equal(s.label, "Bearish");
});

test("decimal values are summed without floating point drift", () => {
  const s = calculateSentiment([0.1, 0.2, -0.3]);
  assert.equal(s.bullishStrength, 0.3);
  assert.equal(s.bearishStrength, 0.3);
  assert.equal(s.percent, 0);
  assert.equal(s.label, "Neutral");
});

test("label follows the rounded percentage, never -0", () => {
  const s = calculateSentiment([100, -99.5]); // 0.25% -> rounds to 0
  assert.equal(s.percent, 0);
  assert.equal(Object.is(s.percent, -0), false);
  assert.equal(s.label, "Neutral");
  const t = calculateSentiment([99.5, -100]);
  assert.equal(Object.is(t.percent, -0), false);
  assert.equal(t.label, "Neutral");
});

test("non-finite values are ignored", () => {
  const s = calculateSentiment([Number.NaN, 2, Number.POSITIVE_INFINITY]);
  assert.equal(s.bullishStrength, 2);
});

test("counts and directions", () => {
  assert.deepEqual(countAlerts([2, 1, 0, -1, -2, 0]), { bullish: 2, bearish: 2, neutral: 2, active: 6 });
  assert.equal(directionOf(0.001), "Neutral"); // below the 2-decimal precision
  assert.equal(directionOf(-0.01), "Bearish");
});

test("formatting helpers", () => {
  assert.equal(formatSignal(2), "+2");
  assert.equal(formatSignal(-1), "−1");
  assert.equal(formatSignal(0), "0");
  assert.equal(formatSignal(1.5), "+1.5");
  assert.equal(scaleOffset(-100), 0);
  assert.equal(scaleOffset(0), 50);
  assert.equal(scaleOffset(33), 66.5);
  assert.equal(scaleOffset(250), 100);
});

test("donut segments cover the full circle in order", () => {
  const segs = donutSegments({ bullish: 2, neutral: 1, bearish: 1 });
  assert.deepEqual(segs.map((s) => s.key), ["bullish", "neutral", "bearish"]);
  assert.equal(segs.reduce((sum, s) => sum + s.length, 0), 100);
  assert.deepEqual(donutSegments({ bullish: 0, neutral: 0, bearish: 0 }), []);
});

test("alert shares are whole numbers that add up to 100", () => {
  assert.deepEqual(alertShares({ bullish: 5, bearish: 2, neutral: 1 }), { bullish: 62, bearish: 25, neutral: 13 });
  assert.deepEqual(alertShares({ bullish: 1, bearish: 1, neutral: 1 }), { bullish: 34, bearish: 33, neutral: 33 });
  assert.deepEqual(alertShares({ bullish: 0, bearish: 0, neutral: 0 }), { bullish: 0, bearish: 0, neutral: 0 });
  assert.deepEqual(alertShares({ bullish: 3, bearish: 0, neutral: 0 }), { bullish: 100, bearish: 0, neutral: 0 });
});
