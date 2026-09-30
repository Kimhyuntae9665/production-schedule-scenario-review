import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scenario, fingerprint } from '../fixture.mjs';
import { solve } from '../planner.mjs';
import { verify } from '../verifier.mjs';

const gold = JSON.parse(readFileSync(new URL('../gold.json', import.meta.url)));
const clone = value => structuredClone(value);

for (const [name, count] of [['A', 12], ['B', 12], ['C', 144]]) {
  test(`actual exact enumeration ${name} proves original optimum`, () => {
    const input = scenario(name), before = fingerprint(input), result = solve(input);
    assert.equal(result.status, 'OPTIMAL');
    assert.equal(result.makespan, gold[name].optimum);
    assert.equal(result.lowerBound, gold[name].optimum);
    assert.equal(result.proof.complete, true);
    assert.equal(result.proof.enumerated, count);
    assert.equal(result.proof.totalSequences, count);
    assert.equal(result.proof.termination, 'exhausted');
    assert.equal(verify(input, result.schedule, { reportedMakespan: result.makespan }).status, 'VALID');
    assert.equal(fingerprint(input), before, 'solver must not mutate source');
    assert.equal(verify(input, gold[name].schedule).status, 'VALID', 'handwritten oracle independently verified');
  });
}

test('other valid 7-minute schedule accepted, half-open operations may touch', () => {
  const other = clone(gold.A.schedule);
  Object.assign(other.find(op => op.id === 'J2B'), { start: 3, end: 5 });
  Object.assign(other.find(op => op.id === 'J3A'), { start: 5, end: 7 });
  assert.equal(verify(scenario(), other, { reportedMakespan: 7 }).status, 'VALID');
});

test('original base plan crosses changed outage', () => {
  const result = verify(scenario('B'), gold.A.schedule);
  assert.equal(result.status, 'INVALID');
  assert.ok(result.issues.some(issue => issue.includes('overlaps outage')));
});

test('missing J3 fails even without overlaps', () => {
  const result = verify(scenario(), gold.A.schedule.filter(op => op.id !== 'J3A'));
  assert.equal(result.status, 'INVALID');
  assert.ok(result.issues.some(issue => issue.includes('J3A: missing')));
});

test('coverage must be exactly once; unknown operations fail', () => {
  assert.equal(verify(scenario(), [...gold.A.schedule, gold.A.schedule[0]]).status, 'INVALID');
  assert.equal(verify(scenario(), [...gold.A.schedule, { id: 'FAKE', jobId: 'J1', machine: 'M2', start: 8, end: 9 }]).status, 'INVALID');
});

test('missing duration and unknown machine are INVALID input rather than INFEASIBLE', () => {
  for (const mutate of [s => { delete s.jobs[0].operations[0].duration; }, s => { s.jobs[0].operations[0].machine = 'Cutter'; }]) {
    const input = scenario(); mutate(input);
    assert.equal(solve(input).status, 'INVALID');
    assert.equal(verify(input, gold.A.schedule).status, 'INVALID');
  }
});

test('integer units/origin/release/objective and unsupported frozen jobs rejected', () => {
  for (const mutate of [s => { s.unit = 'second'; }, s => { s.origin = 1; }, s => { s.jobs[0].release = 1; }, s => { s.objective = 'lateness'; }, s => { s.jobs[0].operations[0].frozen = true; }, s => { s.jobs[0].operations[0].duration = 0.5; }]) {
    const input = scenario(); mutate(input);
    assert.equal(solve(input).status, 'INVALID');
    assert.equal(verify(input, gold.A.schedule).status, 'INVALID');
  }
});

test('horizon 6 infeasible by workload proof without enumerating', () => {
  const result = solve(scenario(), { horizon: 6 });
  assert.equal(result.status, 'INFEASIBLE');
  assert.equal(result.lowerBound, 7);
  assert.equal(result.proof.complete, true);
  assert.equal(result.proof.enumerated, 0);
  assert.equal(result.proof.termination, 'lower-bound-exceeds-horizon');
});

test('search budget returns UNKNOWN with independently valid nonoptimal incumbent', () => {
  const input = scenario(), result = solve(input, { maxSequences: 1 });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.proof.complete, false);
  assert.equal(result.proof.termination, 'sequence-budget');
  assert.equal(result.proof.enumerated, 1);
  assert.ok(result.makespan > result.lowerBound, 'incumbent does not meet the optimum bound');
  assert.equal(verify(input, result.schedule).status, 'VALID');
});

test('zero wall-time budget is UNKNOWN without false infeasibility', () => {
  const result = solve(scenario(), { timeoutMs: 0 });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.proof.complete, false);
  assert.equal(result.proof.termination, 'timeout');
  assert.deepEqual(result.schedule, []);
  assert.equal(result.makespan, undefined);
});

test('deadline tighter than necessary is proven infeasible by complete enumeration', () => {
  const input = scenario('C'); input.jobs.at(-1).deadline = 1;
  const result = solve(input);
  assert.equal(result.status, 'INFEASIBLE');
  assert.equal(result.proof.complete, true);
  assert.equal(result.proof.enumerated, 144);
});

test('deadline, precedence, duration, fixed machine and reported makespan independently recomputed', () => {
  const input = scenario('C'); input.jobs.at(-1).deadline = 3;
  assert.equal(verify(input, gold.C.schedule).status, 'INVALID');
  for (const mutate of [rows => { rows.find(op => op.id === 'J1B').start = 2; rows.find(op => op.id === 'J1B').end = 4; }, rows => { rows[0].end++; }, rows => { rows[0].machine = 'M2'; }, rows => { rows[0].jobId = 'J2'; }]) {
    const rows = clone(gold.A.schedule); mutate(rows);
    assert.equal(verify(scenario(), rows).status, 'INVALID');
  }
  assert.equal(verify(scenario(), gold.A.schedule, { reportedMakespan: 6 }).status, 'INVALID');
  assert.equal(verify(scenario(), gold.A.schedule, { horizon: 6 }).status, 'INVALID');
});

test('calendar union handles overlaps and exact outage boundaries', () => {
  const input = scenario('B'); input.outages.push({ machine: 'M1', start: 3, end: 4 });
  const result = solve(input);
  assert.equal(result.status, 'OPTIMAL'); assert.equal(result.makespan, 9); assert.equal(result.lowerBound, 9);
  assert.equal(verify(input, gold.B.schedule).status, 'VALID');
});

test('fresh fixtures and stable fingerprints invalidate changed calendars', () => {
  const first = scenario(), second = scenario();
  first.jobs[0].operations[0].duration = 99;
  assert.equal(second.jobs[0].operations[0].duration, 3);
  assert.equal(fingerprint(second), fingerprint({ ...second, jobs: second.jobs }));
  const old = fingerprint(second); second.outages.push({ machine: 'M1', start: 2, end: 4 });
  assert.notEqual(fingerprint(second), old);
});

test('malformed values fail without throwing', () => {
  for (const value of [null, {}, { ...scenario(), jobs: [null] }, { ...scenario(), outages: [null] }]) {
    assert.equal(solve(value).status, 'INVALID');
    assert.equal(verify(value, []).status, 'INVALID');
  }
  assert.equal(verify(scenario(), [null]).status, 'INVALID');
  for (const options of [{ maxSequences: -1 }, { timeoutMs: -1 }, { horizon: 6.5 }]) assert.equal(solve(scenario(), options).status, 'INVALID');
});
