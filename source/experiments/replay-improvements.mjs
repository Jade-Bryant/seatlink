import { at, RULES } from '../src/engine.js';
import { buildPressureWorkload, buildReplayWorkloads, PEAK_HOURS, POLICIES, runWorkload } from './reservation-replay.mjs';

const baseline = POLICIES[0];
const renewal = POLICIES.find(policy => policy.id === 'renew');
const combined = POLICIES.find(policy => policy.id === 'both');
const CONFIRM_LEAD = 15;
const minFirst = (policy, minutes) => ({
  ...policy, id: `${policy.id}-${minutes}`, basePolicy: policy.id, minFirstSegmentMinutes: minutes,
});

const waitlist = {
  ...minFirst(baseline, 60), id: 'baseline-waitlist', label: '60 分钟＋释放后候补', waitlistMinutes: 30,
};
const waitlistAtStart = {
  ...waitlist, id: 'baseline-waitlist-at-start', label: '60 分钟＋从目标开始候补', waitlistAtStart: true,
};
const defer = policy => ({
  ...policy, id: `${policy.id}-deferred`, label: `${policy.label}，逐段确认`, confirmLeadMinutes: CONFIRM_LEAD,
});

function firstSegmentPolicies() {
  const policies = [60, 45, 30].flatMap(minimum => POLICIES.map(policy => minFirst(policy, minimum)));
  policies.push(waitlist, waitlistAtStart);
  return policies;
}

export function compareFirstSegmentMinimums(data, { observed, pressure } = buildReplayWorkloads(data)) {
  const policies = firstSegmentPolicies();
  return [observed, pressure].map(workload => runWorkload(data, workload, policies, true));
}

export function compareConfirmationTiming(data, { observed, pressure } = buildReplayWorkloads(data)) {
  return [60, 30].map(minutes => {
    const eager = minFirst(combined, minutes);
    return { minFirstSegmentMinutes: minutes,
      workloads: [observed, pressure].map(workload => runWorkload(data, workload, [eager, defer(eager)], true)),
    };
  });
}

function addRequests(observed, extra, id) {
  const lastId = Math.max(...observed.requests.map(request => request.id));
  const requests = extra.map((request, index) => ({
    ...request, id: lastId + index + 1, readerId: `additional-${index + 1}`, added: true,
  }));
  return { id, requests: [...observed.requests, ...requests], addedCount: requests.length };
}

function peakWorkload(data, observed, addedCount, close) {
  const eveningStart = at(data.date, PEAK_HOURS[0] * 3600);
  const allStarts = 80;
  const sampleEvery = allStarts / addedCount;
  const startsSpanMinutes = 150;
  const durations = [120, 150, 180];
  const leadTimes = [20, 40, 60];
  const extra = Array.from({ length: addedCount }, (_, index) => {
    const sample = index * sampleEvery;
    const start = eveningStart + Math.floor(sample * startsSpanMinutes / allStarts) * 60;
    const end = Math.min(close, start + durations[sample % durations.length] * 60);
    const lead = leadTimes[Math.floor(sample / durations.length) % leadTimes.length];
    return { submit: start - lead * 60, start, end, release: end };
  });
  return addRequests(observed, extra, `peak+${addedCount}`);
}

function readLocalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(value)) {
    throw new Error('时间须包含秒和 +08:00 时区');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) ||
      new Date(milliseconds + 8 * 3600 * 1000).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error('时间无效');
  }
  return milliseconds / 1000;
}

export function buildUnfulfilledWorkload(data, { observed, open, close }, input) {
  if (input?.date !== data.date || !Array.isArray(input.requests) || !input.requests.length) {
    throw new Error('补充意向须与预约表同日，并包含至少一条最终未约成的请求。');
  }
  const extra = input.requests.map((record, row) => {
    try {
      if (record?.outcome !== 'unfulfilled') throw new Error('仅可补充最终未约成的意向');
      const submit = readLocalTime(record.submittedAt);
      const start = readLocalTime(record.desiredStart);
      const end = readLocalTime(record.desiredEnd);
      if (submit > start || start < open || end > close || end <= start || end - start > RULES.maxDuration) {
        throw new Error('提交顺序或需求时段超出当天的开馆范围');
      }
      return { submit, start, end, release: end };
    } catch (error) {
      throw new Error(`补充意向第 ${row + 1} 条：${error.message}。`);
    }
  });
  return addRequests(observed, extra, 'unfulfilled-input');
}

export function comparePeakDemand(data, inputs = buildReplayWorkloads(data), unfulfilled) {
  const { observed, close } = inputs;
  const policies = [
    minFirst(baseline, 60), minFirst(baseline, 30),
    minFirst(combined, 60), defer(minFirst(combined, 60)),
    minFirst(combined, 30), defer(minFirst(combined, 30)),
    defer(minFirst(renewal, 30)),
  ];
  const workloads = [
    inputs.pressure,
    ...[40, 80].map(count => peakWorkload(data, observed, count, close)),
  ];
  if (unfulfilled !== undefined) workloads.push(buildUnfulfilledWorkload(data, inputs, unfulfilled));
  return workloads.map(workload => runWorkload(data, workload, policies, true));
}

export function runReplayImprovements(data, unfulfilled) {
  const inputs = buildReplayWorkloads(data);
  return {
    date: data.date, seatCount: data.seats.length, sourceSha256: data.sourceSha256, peakHours: PEAK_HOURS,
    firstSegment: compareFirstSegmentMinimums(data, inputs),
    confirmation: compareConfirmationTiming(data, inputs),
    peakDemand: comparePeakDemand(data, inputs, unfulfilled),
  };
}

export function heavyPressurePolicies() {
  return [
    ...firstSegmentPolicies(),
    defer(minFirst(combined, 60)),
    defer(minFirst(combined, 30)),
    defer(minFirst(renewal, 30)),
  ];
}

export function runHeavyPressure(data) {
  const { observed } = buildReplayWorkloads(data);
  const policies = heavyPressurePolicies();
  return {
    date: data.date, seatCount: data.seats.length, sourceSha256: data.sourceSha256, peakHours: PEAK_HOURS,
    sourceRequests: observed.requests.length,
    workloads: [50, 100].map(increasePercent => ({
      increasePercent,
      ...runWorkload(data, buildPressureWorkload(observed, increasePercent), policies, true),
    })),
  };
}
