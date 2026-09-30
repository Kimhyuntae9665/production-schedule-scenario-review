import { createHash } from 'node:crypto';

export function scenario(id = 'A') {
  if (!['A', 'B', 'C'].includes(id)) throw new Error(`Unknown fixture scenario: ${id}`);
  const value = {
    id, revision: '1', origin: 0, unit: 'minute', machines: ['M1', 'M2'], objective: 'makespan',
    jobs: [
      { id: 'J1', release: 0, operations: [{ id: 'J1A', machine: 'M1', duration: 3 }, { id: 'J1B', machine: 'M2', duration: 2 }] },
      { id: 'J2', release: 0, operations: [{ id: 'J2A', machine: 'M2', duration: 2 }, { id: 'J2B', machine: 'M1', duration: 2 }] },
      { id: 'J3', release: 0, operations: [{ id: 'J3A', machine: 'M1', duration: 2 }] }
    ],
    outages: id === 'B' ? [{ machine: 'M1', start: 2, end: 4 }] : []
  };
  if (id === 'C') value.jobs.push({ id: 'J4', release: 0, deadline: 4, operations: [{ id: 'J4A', machine: 'M2', duration: 1 }, { id: 'J4B', machine: 'M1', duration: 1 }] });
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
