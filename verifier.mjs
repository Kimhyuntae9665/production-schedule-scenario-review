// Deliberately independent of planner and handwritten gold. Recompute every constraint.
export function verify(scenario, schedule, { reportedMakespan, horizon } = {}) {
  const issues = [];
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value);
  const fields = (value, allowed, label) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`${label}: unsupported field ${key}`); };
  const invalid = () => ({ status: 'INVALID', issues, checkedOperations: 0 });
  if (!object(scenario)) { issues.push('Scenario is not an object'); return invalid(); }
  fields(scenario, ['id', 'revision', 'origin', 'unit', 'machines', 'jobs', 'outages', 'objective'], 'Scenario');
  if (!id(scenario.id) || !['string', 'number'].includes(typeof scenario.revision) || String(scenario.revision).length === 0) issues.push('Invalid scenario identity/revision');
  if (scenario.origin !== 0 || scenario.unit !== 'minute') issues.push('Expected integer minute units at origin 0');
  if (scenario.objective !== 'makespan') issues.push('Unsupported objective');
  if (!Array.isArray(scenario.machines) || scenario.machines.length !== 2 || new Set(scenario.machines).size !== 2 || !scenario.machines.includes('M1') || !scenario.machines.includes('M2')) issues.push('Expected unique M1/M2 machines');
  if (!Array.isArray(scenario.jobs) || scenario.jobs.length === 0) issues.push('Scenario requires jobs');
  if (!Array.isArray(scenario.outages)) issues.push('Scenario requires outage array');
  const required = new Map(), jobIds = new Set();
  for (const job of Array.isArray(scenario.jobs) ? scenario.jobs : []) {
    if (!object(job)) { issues.push('Malformed job'); continue; }
    fields(job, ['id', 'release', 'operations', 'deadline'], 'Job');
    if (!id(job.id) || jobIds.has(job.id)) issues.push('Invalid/duplicate job ID');
    jobIds.add(job.id);
    if (job.release !== 0) issues.push(`${job.id}: release must be 0`);
    if (job.deadline !== undefined && !integer(job.deadline)) issues.push(`${job.id}: invalid deadline`);
    if (!Array.isArray(job.operations) || !job.operations.length) issues.push(`${job.id}: missing operations`);
    for (const op of Array.isArray(job.operations) ? job.operations : []) {
      if (!object(op)) { issues.push('Malformed operation'); continue; }
      fields(op, ['id', 'machine', 'duration'], 'Operation');
      if (!id(op.id) || required.has(op.id)) issues.push('Invalid/duplicate required operation ID');
      if (!['M1', 'M2'].includes(op.machine)) issues.push(`${op.id}: unknown machine`);
      if (!integer(op.duration) || op.duration === 0) issues.push(`${op.id}: invalid duration`);
      required.set(op.id, { ...op, jobId: job.id });
    }
  }
  if (required.size > 12) issues.push('More than 12 operations exceeds this slice');
  for (const o of Array.isArray(scenario.outages) ? scenario.outages : []) {
    if (!object(o)) { issues.push('Malformed outage'); continue; }
    fields(o, ['machine', 'start', 'end'], 'Outage');
    if (!['M1', 'M2'].includes(o.machine) || !integer(o.start) || !integer(o.end) || o.start >= o.end) issues.push('Invalid outage');
  }
  if (!issues.length) {
    const duration = [...required.values()].reduce((sum, op) => sum + op.duration, 0);
    if (!Number.isSafeInteger(duration + Math.max(0, ...scenario.outages.map(o => o.end)))) issues.push('Combined duration/calendar exceeds safe integer range');
  }
  if (reportedMakespan !== undefined && !integer(reportedMakespan)) issues.push('Invalid reported makespan');
  if (horizon !== undefined && !integer(horizon)) issues.push('Invalid horizon');
  if (issues.length) return invalid();
  if (!Array.isArray(schedule)) { issues.push('Schedule must be an array'); return invalid(); }
  const actual = new Map();
  for (const row of schedule) {
    if (!object(row)) { issues.push('Malformed schedule row'); continue; }
    fields(row, ['id', 'jobId', 'machine', 'start', 'end'], 'Schedule row');
    if (actual.has(row.id)) issues.push(`${row.id}: duplicate scheduled operation`);
    else actual.set(row.id, row);
    const expected = required.get(row.id);
    if (!expected) { issues.push(`${String(row.id)}: unknown operation`); continue; }
    if (row.jobId !== expected.jobId) issues.push(`${row.id}: job ID mismatch`);
    if (row.machine !== expected.machine) issues.push(`${row.id}: fixed machine mismatch`);
    if (!integer(row.start) || !integer(row.end) || row.end <= row.start) { issues.push(`${row.id}: invalid half-open integer interval`); continue; }
    if (row.end - row.start !== expected.duration) issues.push(`${row.id}: duration mismatch`);
    for (const o of scenario.outages) if (o.machine === row.machine && row.start < o.end && o.start < row.end) issues.push(`${row.id}: overlaps outage [${o.start},${o.end})`);
  }
  for (const operationId of required.keys()) if (!actual.has(operationId)) issues.push(`${operationId}: missing required operation`);
  const timed = [...actual.values()].filter(row => integer(row.start) && integer(row.end) && row.end > row.start);
  for (const machine of scenario.machines) {
    const rows = timed.filter(row => row.machine === machine).sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].start >= rows[i].end) break;
      if (rows[i].start < rows[j].end && rows[j].start < rows[i].end) issues.push(`${machine}: ${rows[i].id}/${rows[j].id} overlap`);
    }
  }
  for (const job of scenario.jobs) {
    for (let i = 1; i < job.operations.length; i++) {
      const previous = actual.get(job.operations[i - 1].id), current = actual.get(job.operations[i].id);
      if (previous && current && current.start < previous.end) issues.push(`${current.id}: job precedence violated`);
    }
    const last = actual.get(job.operations.at(-1).id);
    if (job.deadline !== undefined && last && last.end > job.deadline) issues.push(`${job.id}: hard completion deadline exceeded`);
  }
  const makespan = Math.max(0, ...timed.map(row => row.end));
  if (reportedMakespan !== undefined && reportedMakespan !== makespan) issues.push(`Reported makespan ${reportedMakespan} differs from recomputed ${makespan}`);
  if (horizon !== undefined && makespan > horizon) issues.push('Schedule exceeds horizon');
  return { status: issues.length ? 'INVALID' : 'VALID', issues, makespan, checkedOperations: required.size };
}
