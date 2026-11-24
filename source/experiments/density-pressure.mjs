import { RULES } from '../src/engine.js';
import { buildReplayWorkloads, PEAK_HOURS, runWorkload } from './reservation-replay.mjs';
import { heavyPressurePolicies } from './replay-improvements.mjs';

const MINUTE = 60;
const BIN_MINUTES = 30;
const BIN_SECONDS = BIN_MINUTES * MINUTE;
const MIN_DURATION = RULES.minDuration / MINUTE;
const MAX_DURATION = RULES.maxDuration / MINUTE;
const MIN_POLICY_MINUTES = 45;
const DURATION_JITTER_MINUTES = 10;
const SEEDS = Array.from({ length: 10 }, (_, index) => index + 1);

function randomFor(seed, bucket) {
  let state = (Math.imul(seed, 0x85ebca6b) ^ Math.imul(bucket + 1, 0x9e3779b9)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function countsByBucket(sizes, total) {
  const denominator = sizes.reduce((sum, count) => sum + count, 0);
  const whole = sizes.map(count => Math.floor(count * total / denominator));
  const order = sizes.map((count, index) => ({
    index, remainder: (count * total) % denominator,
  })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = total - whole.reduce((sum, count) => sum + count, 0);
  for (const { index } of order.slice(0, remaining)) whole[index]++;
  return whole;
}

function pickDuration(donor, upper, close, random) {
  const donorLimit = Math.min(RULES.maxDuration, close - donor.start);
  const availableBeyondMinimum = donorLimit - RULES.minDuration;
  const share = availableBeyondMinimum > 0
    ? (donor.end - donor.start - RULES.minDuration) / availableBeyondMinimum
    : 0;
  // Scale the observed share of the open window before drawing within bounds.
  const center = Math.round(MIN_DURATION + share * (upper - MIN_DURATION));
  const low = Math.max(MIN_DURATION, center - DURATION_JITTER_MINUTES);
  const high = Math.min(upper, center + DURATION_JITTER_MINUTES);
  return low + Math.floor(random() * (high - low + 1));
}

export function buildDensityWorkload({ observed, active, open, close }, increasePercent, seed) {
  if (!active.length) throw new Error('没有可用于密度抽样的有效预约。');
  if (!Number.isFinite(increasePercent) || increasePercent < 0) throw new Error('加量比例须为非负数。');
  if (!Number.isInteger(seed)) throw new Error('随机种子须为整数。');
  const buckets = Array.from({ length: Math.ceil((close - open) / BIN_SECONDS) }, () => []);
  for (const request of active) buckets[Math.floor((request.start - open) / BIN_SECONDS)].push(request);
  const observedBinCounts = buckets.map(bucket => bucket.length);
  const addedCount = Math.ceil(observed.requests.length * increasePercent / 100);
  const addedBinCounts = countsByBucket(observedBinCounts, addedCount);
  const lastId = Math.max(...observed.requests.map(request => request.id));
  const added = [];

  for (const [index, count] of addedBinCounts.entries()) {
    if (!count) continue;
    const startMin = open + index * BIN_SECONDS;
    const lastStart = Math.min(startMin + BIN_SECONDS - MINUTE, close - RULES.minDuration);
    const startChoices = Math.floor((lastStart - startMin) / MINUTE) + 1;
    if (startChoices < 1) throw new Error('开始时段超出可预约范围。');
    const donors = buckets[index];
    const random = randomFor(seed, index);
    const drawDonor = () => donors[Math.floor(random() * donors.length)];
    for (let i = 0; i < count; i++) {
      const start = startMin + Math.floor(random() * startChoices) * MINUTE;
      const upper = Math.min(MAX_DURATION, Math.floor((close - start) / MINUTE));
      const duration = pickDuration(drawDonor(), upper, close, random);
      const advance = drawDonor();
      const releaseDonor = drawDonor();
      const retainedRatio = (releaseDonor.release - releaseDonor.start) / (releaseDonor.end - releaseDonor.start);
      const seconds = duration * MINUTE;
      const ordinal = added.length + 1;
      added.push({
        id: lastId + ordinal, readerId: `density-${ordinal}`, added: true,
        submit: start - (advance.start - advance.submit),
        start, end: start + seconds,
        release: start + Math.max(1, Math.round(retainedRatio * seconds)),
      });
    }
  }
  return {
    id: `density+${increasePercent}`, requests: [...observed.requests, ...added],
    addedCount, observedBinCounts, addedBinCounts,
  };
}

function distribution(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0;
  return { mean, min: Math.min(...values), max: Math.max(...values), sd: Math.sqrt(variance) };
}

function durationSummary(minutes) {
  const sorted = [...minutes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { ...distribution(sorted), median };
}

function metrics(group, effectiveRequests) {
  return {
    firstFailed: group.firstFailed,
    complete: group.complete,
    occupancyPercent: group.utilization * 100,
    occupiedMinutes: group.occupiedSeconds / MINUTE,
    unserved: effectiveRequests - group.served,
    switches: group.switches,
    peakRequests: group.peak.requests,
    peakFirstFailed: group.peak.firstFailed,
    peakComplete: group.peak.complete,
    peakOccupancyPercent: group.peak.utilization * 100,
  };
}

function summarizePolicies(policies, trials) {
  return policies.map(policy => {
    const metricNames = Object.keys(trials[0].groups[policy.id]);
    const averages = {};
    const deltaAgainstControl = {};
    for (const name of metricNames) {
      const values = trials.map(trial => trial.groups[policy.id][name]);
      const deltas = trials.map((trial, index) => values[index] - trial.groups[policies[0].id][name]);
      averages[name] = distribution(values);
      deltaAgainstControl[name] = {
        ...distribution(deltas),
        higherRuns: deltas.filter(delta => delta > 1e-9).length,
        lowerRuns: deltas.filter(delta => delta < -1e-9).length,
      };
    }
    return { ...policy, averages, deltaAgainstControl };
  });
}

export function runDensityPressure(data, { seeds = SEEDS, onTrial } = {}) {
  if (!seeds.length) throw new Error('至少指定一个随机种子。');
  const inputs = buildReplayWorkloads(data);
  const policies = heavyPressurePolicies().filter(policy => policy.minFirstSegmentMinutes >= MIN_POLICY_MINUTES);
  const workloads = [50, 100].map(increasePercent => {
    const durations = [];
    const trials = [];
    let totals;
    for (const seed of seeds) {
      const workload = buildDensityWorkload(inputs, increasePercent, seed);
      const { requests, addedCount, observedBinCounts, addedBinCounts } = workload;
      const added = requests.slice(inputs.observed.requests.length);
      const result = runWorkload(data, workload, policies, true);
      if (!totals) totals = {
        addedCount, totalRequests: result.totalRequests, effectiveRequests: result.effectiveRequests,
        observedBinCounts, addedBinCounts,
      };
      trials.push({
        seed,
        syntheticDesiredMinutes: added.reduce((sum, r) => sum + (r.end - r.start) / MINUTE, 0),
        totalEffectiveDemandMinutes: result.demandSeconds / MINUTE,
        groups: Object.fromEntries(result.groups.map(group => [group.id, metrics(group, result.effectiveRequests)])),
      });
      durations.push(...added.map(r => (r.end - r.start) / MINUTE));
      onTrial?.(increasePercent, seed);
    }
    return {
      increasePercent, ...totals, durationMinutes: durationSummary(durations),
      syntheticDesiredMinutes: distribution(trials.map(trial => trial.syntheticDesiredMinutes)),
      totalEffectiveDemandMinutes: distribution(trials.map(trial => trial.totalEffectiveDemandMinutes)),
      groups: summarizePolicies(policies, trials), trials,
    };
  });

  return {
    date: data.date, seatCount: data.seats.length, sourceSha256: data.sourceSha256,
    seeds: [...seeds], peakHours: PEAK_HOURS, open: inputs.open, close: inputs.close, binMinutes: BIN_MINUTES,
    sourceRequests: inputs.observed.requests.length, sourceEffectiveRequests: inputs.active.length,
    sourceDurationMinutes: durationSummary(inputs.active.map(r => (r.end - r.start) / MINUTE)),
    durationMinimumMinutes: MIN_DURATION, durationMaximumMinutes: MAX_DURATION,
    policyMinimumMinutes: MIN_POLICY_MINUTES, durationJitterMinutes: DURATION_JITTER_MINUTES, workloads,
  };
}
