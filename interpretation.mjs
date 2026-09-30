import {fingerprint} from './fixture.mjs';
import {createHash} from 'node:crypto';
const span=(text,start=0,end=text.length)=>({start,end,text:text.slice(start,end)});
export function ruleProposal(scenario,text){
 const p={sourceFingerprint:fingerprint(scenario),sourceText:text,unit:'minute',origin:0,changes:[],unsupportedClauses:[],issues:[],status:'CLARIFY',method:'bounded-rule-parser'};
 if(typeof text!=='string'||!text.trim()||text.length>2000){p.issues=['Provide a bounded scenario request.'];return p;}
 const unsupported=[];
 if(/supplier|ignore restrictions|execute python|\bSQL\b|\bMIP code\b|set .*speed/i.test(text))unsupported.push('Untrusted supplier/code/control instructions are unsupported.');
 if(/don['’]t move|frozen|already[- ]started|without stopping/i.test(text))unsupported.push('Started/frozen job replanning is unsupported.');
 if(/lateness|tardiness|throughput|color|colour|blue orders|red orders/i.test(text))unsupported.push('Only makespan and the allowlisted constraints are supported.');
 const outage=/(?:Make\s+)?(\w+)\s+unavailable\s+from\s+(minute|second)\s+(\d+(?:\.\d+)?)\s+to\s+(?:minute|second)\s+(\d+(?:\.\d+)?)/i.exec(text);
 if(outage){
  const [phrase,machine,unit,startRaw,endRaw]=outage;const start=Number(startRaw)/(unit.toLowerCase()==='second'?60:1),end=Number(endRaw)/(unit.toLowerCase()==='second'?60:1);
  if(!scenario.machines.includes(machine))unsupported.push('Unknown machine alias; no automatic mapping.');
  else if(!Number.isInteger(start)||!Number.isInteger(end)){p.issues.push('Integer-minute grid cannot represent these seconds exactly.');}
  else if(start<0||end<=start||end>30)p.issues.push('Outage requires 0 <= start < end <= 30 minutes.');
  else p.changes.push({type:'add_outage',machine,start,end,unit:'minute',origin:0,phrase:span(text,outage.index,outage.index+phrase.length)});
 }
 const job=/Add\s+(urgent\s+)?J4:\s*J4A\s+on\s+(\w+)\s+for\s+(\d+)\s+minute[s]?,\s*then\s+J4B\s+on\s+(\w+)\s+for\s+(\d+)\s+minute[s]?(?:;\s*complete\s+J4\s+by\s+minute\s+(\d+))?/i.exec(text);
 if(job){
  const [phrase,,first,d1,second,d2,deadline]=job;
  if(!scenario.machines.includes(first)||!scenario.machines.includes(second))unsupported.push('Unknown machine alias; no automatic mapping.');
  else if(!deadline)p.issues.push('Urgent does not define a hard deadline. Specify completion minute.');
  else if(Number(d1)<=0||Number(d2)<=0||Number(d1)>10||Number(d2)>10||Number(deadline)<=0||Number(deadline)>30)p.issues.push('Bounded positive integer durations/deadline required.');
  else p.changes.push({type:'add_job',id:'J4',release:0,operations:[{id:'J4A',machine:first,duration:Number(d1)},{id:'J4B',machine:second,duration:Number(d2)}],deadline:Number(deadline),unit:'minute',origin:0,phrase:span(text,job.index,job.index+phrase.length)});
 }
 // Preserve unsupported residue instead of silently dropping a second clause.
 const covered=[outage,job].filter(Boolean).map(m=>[m.index,m.index+m[0].length]);let residue=text;for(const [a,b]of covered.sort((x,y)=>y[0]-x[0]))residue=residue.slice(0,a)+residue.slice(b);
 if(residue.replace(/[\s.;,]/g,'')&&!unsupported.length)unsupported.push('Unrecognized clause requires clarification or manual input.');
 if(unsupported.length){p.status='UNSUPPORTED';p.unsupportedClauses=[{...span(text),reason:unsupported.join(' ')}];}
 else if(p.issues.length||!p.changes.length)p.status='CLARIFY';else p.status='READY';return p;
}
export function manualProposal(scenario,input){
 let text;
 if(input.type==='add_outage')text=`Make ${input.machine} unavailable from minute ${input.start} to minute ${input.end}.`;
 else if(input.type==='add_job')text=`Add J4: J4A on ${input.machine1} for ${input.duration1} minute, then J4B on ${input.machine2} for ${input.duration2} minute; complete J4 by minute ${input.deadline}.`;
 else return {...ruleProposal(scenario,''),status:'INVALID',issues:['Allowlisted change type required.']};
 return {...ruleProposal(scenario,text),method:'manual-form',sourceText:text};
}
const canonical=value=>{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;};
export function validateInterpretation(scenario,p){
 const issues=[];
 if(!p||typeof p!=='object'||Array.isArray(p))return {valid:false,status:'INVALID',issues:['Proposal object required.']};
 if(p.sourceFingerprint!==fingerprint(scenario))return {valid:false,status:'STALE',issues:['Scenario/calendar fingerprint changed; propose and confirm again.']};
 if(p.unit!=='minute'||p.origin!==0)issues.push('Unit must be integer minutes from origin 0.');
 const expected=ruleProposal(scenario,p.sourceText);
 if(expected.status!=='READY')return {valid:false,status:expected.status,issues:[...expected.issues,...expected.unsupportedClauses.map(c=>c.reason)]};
 if(p.status!=='READY'||!Array.isArray(p.unsupportedClauses)||p.unsupportedClauses.length)issues.push('Unsupported clauses cannot be confirmed.');
 if(JSON.stringify(canonical(p.changes))!==JSON.stringify(canonical(expected.changes)))issues.push('Typed changes or exact phrase spans do not match supported source interpretation.');
 return {valid:issues.length===0,status:issues.length?'INVALID':'READY',issues};
}
export function applyConfirmed(scenario,p){
 const checked=validateInterpretation(scenario,p);if(!checked.valid)throw Error(checked.status+': '+checked.issues.join(' '));
 const result=structuredClone(scenario);result.id='WHAT-IF';result.revision++;
 for(const c of p.changes){if(c.type==='add_outage')result.outages.push({machine:c.machine,start:c.start,end:c.end});else if(c.type==='add_job'){if(result.jobs.some(j=>j.id===c.id))throw Error('Duplicate job ID.');result.jobs.push({id:c.id,release:0,operations:c.operations,deadline:c.deadline});}else throw Error('Unknown change type.');}
 return result;
}
export function receipt(scenario,p,plan,verification,previousHash=null){
 const body={schemaVersion:1,sourceFingerprint:fingerprint(scenario),proposal:structuredClone(p),solverStatus:plan.status,verifierStatus:verification.status,makespan:plan.makespan??null,searchProof:plan.proof,previousHash,humanConfirmation:true,localReviewOnly:true};
 return {...body,hash:createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex')};
}
