import { performance } from 'node:perf_hooks';

const ASSUMPTIONS = Object.freeze([
  'Two fixed exclusive machines M1/M2; all jobs released at integer origin 0; positive integer durations.',
  'Non-preemptive half-open intervals [start,end); only job precedence, machine outages, and hard job completion deadlines.',
  'No setup, transport, material, operator, alternate-machine, started/frozen-operation constraints.',
  'For every machine-order combination, acyclic precedence graph earliest placement dominates later placement for makespan and deadlines.',
  'All machine-order combinations exhausted within budget proves global optimality or infeasibility; incomplete search returns UNKNOWN.'
]);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value);

export function validateScenario(input) {
  const issues = [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed, label) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`${label}: unsupported field ${key}`); };
  if (!object(input)) return ['Scenario must be an object'];
  if (!Array.isArray(input.jobs) || input.jobs.length > 12 || !Array.isArray(input.outages) || input.outages.length > 32) return ['Bounded input requires at most 12 jobs and 32 outages'];
  let count = 0;
  for (const job of input.jobs) {
    if (Array.isArray(job?.operations)) count += job.operations.length;
    if (count > 12) return ['Bounded slice supports at most 12 operations'];
  }
  keys(input, ['id', 'revision', 'origin', 'unit', 'machines', 'jobs', 'outages', 'objective'], 'Scenario');
  if (!identifier(input.id) || !(typeof input.revision === 'string' && input.revision.length > 0 && input.revision.length <= 40 || Number.isSafeInteger(input.revision) && input.revision >= 0)) issues.push('Scenario needs valid id and bounded revision');
  if (input.origin !== 0 || input.unit !== 'minute') issues.push('Only origin 0 and integer minute units are supported');
  if (input.objective !== 'makespan') issues.push('Only makespan objective is supported');
  if (!Array.isArray(input.machines) || input.machines.length !== 2 || new Set(input.machines).size !== 2 || !input.machines.includes('M1') || !input.machines.includes('M2')) issues.push('Machines must be exactly M1 and M2');
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) issues.push('At least one job is required');
  const jobs = new Set(), operations = new Set();
  for (const job of Array.isArray(input.jobs) ? input.jobs : []) {
    if (!object(job)) { issues.push('Job must be an object'); continue; }
    keys(job, ['id', 'release', 'operations', 'deadline'], 'Job');
    if (!identifier(job.id) || jobs.has(job.id)) issues.push('Job IDs must be valid and unique');
    jobs.add(job.id);
    if (job.release !== 0) issues.push(`${job.id}: only release 0 is supported`);
    if (job.deadline !== undefined && (!integer(job.deadline) || job.deadline > 1440)) issues.push(`${job.id}: deadline must be an integer minute in 0..1440`);
    if (!Array.isArray(job.operations) || job.operations.length === 0) issues.push(`${job.id}: operations are required`);
    for (const op of Array.isArray(job.operations) ? job.operations : []) {
      if (!object(op)) { issues.push('Operation must be an object'); continue; }
      keys(op, ['id', 'machine', 'duration'], 'Operation');
      if (!identifier(op.id) || operations.has(op.id)) issues.push('Operation IDs must be valid and globally unique');
      operations.add(op.id);
      if (!['M1', 'M2'].includes(op.machine)) issues.push(`${op.id}: unknown machine`);
      if (!integer(op.duration) || op.duration === 0 || op.duration > 1440) issues.push(`${op.id}: integer duration in 1..1440 is required`);
    }
  }
  if (operations.size > 12) issues.push('Bounded slice supports at most 12 operations');
  if (!Array.isArray(input.outages)) issues.push('Outages must be an array');
  for (const outage of Array.isArray(input.outages) ? input.outages : []) {
    if (!object(outage)) { issues.push('Outage must be an object'); continue; }
    keys(outage, ['machine', 'start', 'end'], 'Outage');
    if (!['M1', 'M2'].includes(outage.machine) || !integer(outage.start) || !integer(outage.end) || outage.end <= outage.start || outage.end > 1440) issues.push('Outage requires known machine and integer 0 <= start < end <= 1440');
  }
  if (!issues.length) {
    const sum = input.jobs.flatMap(job => job.operations).reduce((n, op) => n + op.duration, 0);
    const latest = Math.max(0, ...input.outages.map(outage => outage.end));
    if (!Number.isSafeInteger(sum + latest)) issues.push('Combined duration/calendar exceeds safe integer range');
  }
  return issues;
}

function* permutations(items) {
  if (!items.length) { yield []; return; }
  for (let i = 0; i < items.length; i++) {
    const remaining = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(remaining)) yield [items[i], ...tail];
  }
}

function calendar(scenario, machine) {
  const sorted = scenario.outages.filter(o => o.machine === machine).map(o => ({ ...o })).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const o of sorted) {
    const last = merged.at(-1);
    if (last && o.start <= last.end) last.end = Math.max(last.end, o.end);
    else merged.push(o);
  }
  return merged;
}

function nextStart(start, duration, outages) {
  for (const o of outages) if (start < o.end && start + duration > o.start) start = o.end;
  return start;
}

function workloadFinish(work, outages) {
  let time = 0;
  for (const o of outages) {
    const available = Math.max(0, o.start - time);
    if (work <= available) return time + work;
    work -= available;
    time = Math.max(time, o.end);
  }
  return time + work;
}

function earliest(scenario, orders, operations, calendars) {
  const predecessors = new Map(operations.map(op => [op.id, new Set()]));
  const successors = new Map(operations.map(op => [op.id, new Set()]));
  const edge = (a, b) => { predecessors.get(b).add(a); successors.get(a).add(b); };
  for (const job of scenario.jobs) for (let i = 1; i < job.operations.length; i++) edge(job.operations[i - 1].id, job.operations[i].id);
  for (const order of orders) for (let i = 1; i < order.length; i++) edge(order[i - 1].id, order[i].id);
  const degree = new Map([...predecessors].map(([id, previous]) => [id, previous.size]));
  const byId = new Map(operations.map(op => [op.id, op]));
  const queue = operations.filter(op => degree.get(op.id) === 0).map(op => op.id);
  const placed = new Map();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], op = byId.get(id);
    const ready = Math.max(0, ...[...predecessors.get(id)].map(previous => placed.get(previous).end));
    const start = nextStart(ready, op.duration, calendars.get(op.machine));
    placed.set(id, { id, jobId: op.jobId, machine: op.machine, start, end: start + op.duration });
    for (const next of successors.get(id)) { degree.set(next, degree.get(next) - 1); if (degree.get(next) === 0) queue.push(next); }
  }
  if (placed.size !== operations.length) return null;
  for (const job of scenario.jobs) if (job.deadline !== undefined && placed.get(job.operations.at(-1).id).end > job.deadline) return null;
  return [...placed.values()].sort((a, b) => a.machine.localeCompare(b.machine) || a.start - b.start || a.id.localeCompare(b.id));
}

export function solve(scenario, { maxSequences = 10000, timeoutMs = 1000, horizon } = {}) {
  const started = performance.now();
  const issues = validateScenario(scenario);
  if (!integer(maxSequences) || !Number.isFinite(timeoutMs) || timeoutMs < 0 || (horizon !== undefined && !integer(horizon))) issues.push('Invalid search budget or horizon');
  const proof = { complete: false, enumerated: 0, totalSequences: 0, assumptions: [...ASSUMPTIONS], maxSequences, timeoutMs, termination: 'invalid-input' };
  if (issues.length) return { status: 'INVALID', schedule: [], proof, issues };
  const operations = scenario.jobs.flatMap(job => job.operations.map(op => ({ ...op, jobId: job.id })));
  const calendars = new Map(scenario.machines.map(machine => [machine, calendar(scenario, machine)]));
  const groups = scenario.machines.map(machine => operations.filter(op => op.machine === machine));
  const factorial = n => { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; };
  proof.totalSequences = groups.reduce((product, group) => product * factorial(group.length), 1);
  const lowerBound = Math.max(...groups.map((group, i) => workloadFinish(group.reduce((sum, op) => sum + op.duration, 0), calendars.get(scenario.machines[i]))), ...scenario.jobs.map(job => job.operations.reduce((sum, op) => sum + op.duration, 0)));
  proof.lowerBoundBasis = 'Per-machine workload with unioned outage calendar (preemption relaxation), and job-chain duration';
  if (horizon !== undefined && lowerBound > horizon) {
    proof.complete = true; proof.termination = 'lower-bound-exceeds-horizon';
    return { status: 'INFEASIBLE', schedule: [], lowerBound, proof, issues: [`Makespan lower bound ${lowerBound} exceeds horizon ${horizon}`] };
  }
  let best = null, makespan;
  outer: for (const first of permutations(groups[0])) for (const second of permutations(groups[1])) {
    if (proof.enumerated >= maxSequences) { proof.termination = 'sequence-budget'; break outer; }
    if (performance.now() - started >= timeoutMs) { proof.termination = 'timeout'; break outer; }
    proof.enumerated++;
    const candidate = earliest(scenario, [first, second], operations, calendars);
    if (!candidate) continue;
    const end = Math.max(...candidate.map(op => op.end));
    if (horizon !== undefined && end > horizon) continue;
    if (best === null || end < makespan) { best = candidate; makespan = end; }
  }
  proof.elapsedMs = Number((performance.now() - started).toFixed(3));
  if (proof.enumerated === proof.totalSequences) { proof.complete = true; proof.termination = 'exhausted'; }
  if (!proof.complete) return { status: 'UNKNOWN', schedule: best ?? [], ...(best ? { makespan } : {}), lowerBound, proof, issues: ['Search incomplete; any incumbent is feasible but optimality has not been certified'] };
  return { status: best ? 'OPTIMAL' : 'INFEASIBLE', schedule: best ?? [], ...(best ? { makespan } : {}), lowerBound, proof, issues: best ? [] : ['No feasible machine-order combination exists under declared constraints'] };
}
