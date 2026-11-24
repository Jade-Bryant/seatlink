import assert from 'node:assert/strict';
import test from 'node:test';
import { at, CLOSE, createState, OPEN } from '../src/engine.js';
import { bookPlan, planRenewal, planSeats } from '../src/planner.js';
import { buildPressureWorkload, POLICIES, runReservationReplay, runWorkload } from '../experiments/reservation-replay.mjs';
import { buildUnfulfilledWorkload } from '../experiments/replay-improvements.mjs';
import { buildDensityWorkload } from '../experiments/density-pressure.mjs';

const date = '2026-10-29';
const hour = hours => at(date, hours * 3600);

test('a 45-minute single-seat option takes a 60-minute or longer window when one is feasible', () => {
  const makeState = (firstStop, secondStop) => ({
    ...createState(true), now: hour(12), replayDate: date, minReservationMinutes: 45,
    seats: [{ id: 'A' }, { id: 'B' }],
    reservations: [
      { seatId: 'A', date, start: firstStop, end: hour(17) },
      { seatId: 'B', date, start: secondStop, end: hour(17) },
    ],
  });
  const start = hour(14);
  const request = { start, end: hour(17), minFirstSegmentMinutes: 45, maxSegments: 1, limit: 1 };
  const [preferred] = planSeats(makeState(start + 50 * 60, start + 70 * 60), request).plans;
  assert.equal(preferred.segments[0].seatId, 'B');
  const [fallback] = planSeats(makeState(start + 50 * 60, start + 44 * 60), request).plans;
  assert.equal(fallback.firstSegmentSeconds, 50 * 60);
  assert.equal(planSeats(makeState(start + 44 * 60, start + 44 * 60), request).plans.length, 0);
});

test('density sampling preserves bucket counts, duration bounds, and a deterministic random stream', () => {
  const first = { id: 1, readerId: 'first', submit: hour(7), start: hour(9), end: hour(11), release: hour(10) };
  const second = { id: 2, readerId: 'second', submit: hour(8), start: hour(9.25), end: hour(12.25), release: hour(10.75) };
  const late = { id: 3, readerId: 'late', submit: hour(20), start: hour(21.5), end: hour(22.5), release: hour(22.5) };
  const active = [first, second, late];
  const inputs = { active, observed: { requests: active }, open: at(date, OPEN), close: at(date, CLOSE) };
  const result = buildDensityWorkload(inputs, 100, 4);
  assert.deepEqual(result, buildDensityWorkload(inputs, 100, 4));
  assert.notDeepEqual(result.requests, buildDensityWorkload(inputs, 100, 5).requests);
  assert.equal(result.addedCount, 3);
  assert.deepEqual(result.addedBinCounts, result.observedBinCounts);
  const [one, two, nearClosing] = result.requests.slice(active.length);
  for (const request of [one, two]) {
    assert.ok(request.start >= hour(9) && request.start < hour(9.5));
    assert.ok([75, 120].includes((request.start - request.submit) / 60));
    assert.equal(request.release - request.start, (request.end - request.start) / 2);
  }
  assert.equal(nearClosing.start, hour(21.5));
  assert.equal(nearClosing.end, hour(22.5));
  assert.ok(result.requests.every(r => r.end - r.start >= 3600 && r.end <= hour(22.5)));
});

test('pressure growth uses the original row count and copies only effective demand, even above donor count', () => {
  const observed = { requests: [
    { id: 3, readerId: 'third', submit: hour(8), start: hour(14), end: hour(16), release: hour(16) },
    { id: 1, readerId: 'first', submit: hour(7), start: hour(9), end: hour(11), release: hour(11) },
    { id: 2, readerId: 'cancelled', submit: hour(7), start: hour(12), end: hour(14), release: hour(11) },
  ] };
  const half = buildPressureWorkload(observed, 50);
  const double = buildPressureWorkload(observed, 100);
  assert.equal(half.addedCount, 2);
  assert.deepEqual(double.requests.slice(0, 3).map(r => r.id), [1, 2, 3]);
  assert.equal(double.addedCount, 3);
  assert.deepEqual(double.requests.slice(3).map(r => r.start), [hour(9), hour(9), hour(14)]);
  assert.equal(new Set(double.requests.map(r => r.readerId)).size, 6);
  assert.deepEqual(double, buildPressureWorkload(observed, 100));
});

test('a short first slot can be booked only in the configured trial and a later slot still needs 60 minutes', () => {
  const state = {
    ...createState(true), now: hour(12), replayDate: date, seats: [{ id: 'A' }, { id: 'B' }],
    reservations: [
      { seatId: 'A', date, start: hour(14.5), end: at(date, CLOSE) },
      { seatId: 'B', date, start: at(date, OPEN), end: hour(14.5) },
    ],
  };
  const request = { start: hour(14), end: hour(15.5), minFirstSegmentMinutes: 30 };
  assert.throws(() => planSeats(state, request), /首段最短时长/);
  const trial = { ...state, minReservationMinutes: 30 };
  const [plan] = planSeats(trial, request).plans;
  assert.deepEqual(plan.segments.map(slot => (slot.end - slot.start) / 60), [30, 60]);
  const badLaterSegment = { ...plan.segments[1], end: hour(15) };
  assert.throws(() => bookPlan(trial, { ...plan, segments: [plan.segments[0], badLaterSegment] }), /后续预约段/);
  const partial = planSeats(trial, { ...request, end: hour(15) }).plans[0];
  assert.equal(partial.segments.length, 1);
  const booked = bookPlan(trial, partial);
  const reservationId = booked.reservations.at(-1).id;
  assert.equal(planRenewal(booked, { ...request, end: hour(15), reservationId }).plans.length, 0);
});

test('the extra input accepts only same-day unfulfilled requests and keeps their desired times', () => {
  const data = { date, seats: ['A'] };
  const inputs = {
    open: at(date, OPEN), close: at(date, CLOSE),
    observed: { requests: [{ id: 1, readerId: 'original' }] },
  };
  const request = {
    submittedAt: '2026-10-29T17:30:00+08:00', desiredStart: '2026-10-29T18:00:00+08:00',
    desiredEnd: '2026-10-29T19:30:00+08:00', outcome: 'unfulfilled',
  };
  const result = buildUnfulfilledWorkload(data, inputs, { date, requests: [request] });
  assert.equal(result.addedCount, 1);
  assert.deepEqual(result.requests[1], {
    id: 2, readerId: 'additional-1', added: true, submit: hour(17.5),
    start: hour(18), end: hour(19.5), release: hour(19.5),
  });
  assert.throws(() => buildUnfulfilledWorkload(data, inputs, { date, requests: [{ ...request, outcome: 'booked' }] }), /仅可补充/);
  assert.throws(() => buildUnfulfilledWorkload(data, inputs, { date: '2026-10-30', requests: [request] }), /同日/);
});

test('waitlisting can move the desired start only after an observed release', () => {
  const data = { date, seats: ['A'] };
  const requests = [
    { id: 1, readerId: 'one', seatId: 'A', submit: hour(7), start: at(date, OPEN), end: at(date, CLOSE), release: hour(14) + 600 },
    { id: 2, readerId: 'two', seatId: 'A', submit: hour(9), start: hour(14), end: hour(17), release: hour(17) },
  ];
  const waitlist = { ...POLICIES[0], id: 'waitlist', waitlistMinutes: 30 };
  const [control, trial] = runWorkload(data, { id: 'fixture', requests }, [POLICIES[0], waitlist], true).groups;
  assert.equal(control.firstFailed, 1);
  assert.equal(trial.firstFailed, 1);
  assert.equal(trial.waitlistServed, 1);
  assert.equal(trial.delaySeconds, 600);
  assert.equal(trial.occupiedSeconds - control.occupiedSeconds, (3 * 3600) - 600);
  assert.equal(trial.complete, control.complete);
});

test('a deferred chain leaves its next seat available until the confirmation window', () => {
  const data = { date, seats: ['A', 'B'] };
  const firstEnd = hour(15) + 300;
  const requests = [
    { id: 1, readerId: 'one', submit: hour(7), start: at(date, OPEN), end: firstEnd, release: firstEnd },
    { id: 2, readerId: 'two', submit: hour(7) + 1, start: hour(15), end: at(date, CLOSE), release: at(date, CLOSE) },
    { id: 3, readerId: 'three', submit: hour(9), start: hour(14), end: hour(17), release: hour(17) },
  ];
  const combined = POLICIES.find(policy => policy.id === 'both');
  const deferred = { ...combined, id: 'deferred', confirmLeadMinutes: 15 };
  function atSubmission(submit) {
    const extra = { id: 4, readerId: 'four', submit, start: firstEnd, end: hour(17), release: hour(17) };
    return runWorkload(data, { id: 'fixture', requests: [...requests, extra] }, [combined, deferred], true).groups;
  }
  const [eager, delayed] = atSubmission(hour(13));
  assert.equal(eager.stitched, 1);
  assert.equal(eager.firstFailed, 1);
  assert.equal(delayed.stitched, 0);
  assert.equal(delayed.firstFailed, 0);
  const [, afterGate] = atSubmission(hour(14) + 50 * 60);
  assert.equal(afterGate.renewed, 1);
  assert.equal(afterGate.firstFailed, 1);
});

test('single-segment policy cannot reserve two windows on the same seat', () => {
  const state = {
    ...createState(true),
    now: hour(12),
    replayDate: date,
    seats: [{ id: 'A' }],
    reservations: [{ seatId: 'A', date, start: hour(15), end: hour(15) + 300 }],
  };
  const request = { start: hour(14), end: hour(16) + 300, maxSwitches: 0 };
  const [stitched] = planSeats(state, request).plans;
  assert.equal(stitched.segments.length, 2);
  assert.equal(stitched.switches, 0);
  const [single] = planSeats(state, { ...request, maxSegments: 1 }).plans;
  assert.equal(single.segments.length, 1);
  assert.equal(single.reachesEnd, false);
});

test('a future release stays unavailable to initial plans and enables a later renewal', () => {
  const data = {
    date, seats: ['A', 'B'], endedAfterBooked: 0,
    requests: [
      { id: 1, readerId: 'one', seatId: 'A', submit: hour(7), start: at(date, OPEN), end: at(date, CLOSE), release: at(date, CLOSE) },
      { id: 2, readerId: 'two', seatId: 'B', submit: hour(7) + 1, start: hour(15), end: at(date, CLOSE), release: hour(14.75) },
      { id: 3, readerId: 'three', seatId: 'B', submit: hour(9), start: hour(14), end: hour(17), release: hour(17) },
    ],
  };
  const [workload] = runReservationReplay(data).workloads;
  const [baseline, stitch, renew, both] = workload.groups;
  assert.equal(stitch.occupiedSeconds, baseline.occupiedSeconds);
  assert.equal(renew.occupiedSeconds - baseline.occupiedSeconds, 2 * 3600);
  assert.equal(both.occupiedSeconds, renew.occupiedSeconds);
  assert.equal(renew.renewed, 1);
  assert.equal(renew.switches, 0);
  assert.deepEqual(workload.example.groups[2].decisions.map(({ action, time }) => [action, time]), [
    ['initial', hour(9)], ['renewal', hour(14.75)],
  ]);
  assert.equal(workload.groups[2].bins.reduce((a, b) => a + b, 0), renew.occupiedSeconds);
});
