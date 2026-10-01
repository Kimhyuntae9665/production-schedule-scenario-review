import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDesk} from '../server.mjs';
import {solve,validateScenario} from '../planner.mjs';
import {verify} from '../verifier.mjs';
import {ruleProposal,manualProposal,validateInterpretation,applyConfirmed} from '../interpretation.mjs';
import {fingerprint} from '../fixture.mjs';

// A different job count, operation-chain length, IDs, calendar and deadline;
// no archived interpretation case or handwritten gold supplies its answer.
const input=()=>({id:'LOCAL_CELL',revision:'customer-v2',origin:0,unit:'minute',objective:'makespan',machines:['M1','M2'],jobs:[
 {id:'ORDER_A',release:0,deadline:20,operations:[{id:'CUT_A',machine:'M1',duration:3},{id:'CHECK_A',machine:'M2',duration:2},{id:'FINISH_A',machine:'M1',duration:1}]},
 {id:'ORDER_B',release:0,operations:[{id:'CHECK_B',machine:'M2',duration:2},{id:'CUT_B',machine:'M1',duration:4}]}
],outages:[{machine:'M2',start:4,end:5}]});
const inspect=p=>({proposalId:p.id,proposalHash:p.proposalHash,sourceFingerprint:p.sourceFingerprint,confirmConvention:true});
async function desk(run){
 const server=createDesk();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const state=async()=>await(await fetch(url+'/api/state')).json();
 const post=async(path,body)=>{const r=await fetch(url+'/api/'+path,{method:'POST',body:JSON.stringify(body)});return {code:r.status,body:await r.json()};};
 try{await run({state,post,url});}finally{await new Promise(resolve=>server.close(resolve));}
}

test('user import calculates a different shape, preserves history and blocks stale propose/confirm/review/import/reset',async()=>{
 const originals=['gold.json','interpretation-cases.json','artifacts/model-evaluation.json'].map(path=>[path,readFileSync(new URL('../'+path,import.meta.url))]);
 await desk(async({state,post})=>{
  let x=await state();const originalFingerprint=x.sourceFingerprint;
  x=(await post('propose',{sourceFingerprint:x.sourceFingerprint,text:'Make M1 unavailable from minute 2 to minute 4.'})).body;
  const oldProposal=x.proposal;x=(await post('confirm',inspect(oldProposal))).body;
  const oldReview={...inspect(oldProposal),planFingerprint:x.planFingerprint};x=(await post('review',oldReview)).body;
  const receiptHash=x.latestReceipt.hash,historyLength=x.history.length;
  const imported=await post('import',{sourceFingerprint:x.sourceFingerprint,baseline:input()});assert.equal(imported.code,200);x=imported.body;
  assert.equal(x.source.kind,'user-input');assert.equal(x.source.suppliedRevision,'customer-v2');assert.equal(x.source.inputFingerprint,fingerprint(input()));assert.equal(x.sourceRevision,2);assert.equal(x.base.revision,2);
  assert.equal(x.base.jobs.length,2);assert.equal(x.base.jobs[0].operations.length,3);assert.equal(x.baseline.status,'OPTIMAL');assert.equal(x.baseline.makespan,8);assert.equal(x.baselineVerification.status,'VALID');
  assert.equal(x.proposal,null);assert.equal(x.changedPlan,null);assert.equal(x.planFingerprint,null);assert.equal(x.latestReceipt.hash,receiptHash);assert.equal(x.receiptCompatibility.current,false);assert.equal(x.history.length,historyLength+1);
  for(const [path,body] of [['propose',{sourceFingerprint:originalFingerprint,text:'Make M2 unavailable from minute 1 to minute 2.'}],['confirm',inspect(oldProposal)],['review',oldReview],['import',{sourceFingerprint:originalFingerprint,baseline:input()}],['reset',{sourceFingerprint:originalFingerprint}]])assert.equal((await post(path,body)).code,409,path);
  assert.equal((await post('propose',{text:'Make M2 unavailable from minute 1 to minute 2.'})).code,409,'missing provenance');
  const proposal=(await post('propose',{sourceFingerprint:x.sourceFingerprint,text:'Make M1 unavailable from minute 2 to minute 4.'})).body.proposal;
  x=(await post('confirm',inspect(proposal))).body;assert.equal(x.changedPlan.makespan,12);assert.equal(x.changedVerification.status,'VALID');
  x=(await post('review',{...inspect(proposal),planFingerprint:x.planFingerprint})).body;assert.equal(x.latestReceipt.previousHash,receiptHash);assert.equal(x.receiptCompatibility.current,true);
  const hash=x.sourceFingerprint;x=(await post('reset',{sourceFingerprint:hash})).body;assert.equal(x.source.kind,'synthetic-fixture');assert.equal(x.sourceRevision,3);assert.equal(x.baseline.makespan,7);assert.equal(x.changedPlan,null);assert.ok(x.history.length>historyLength);assert.equal(x.receiptCompatibility.current,false);
  // Reimporting equal bytes still changes source revision and rejects old clients.
  x=(await post('import',{sourceFingerprint:x.sourceFingerprint,baseline:input()})).body;
  const prior=x.sourceFingerprint;x=(await post('import',{sourceFingerprint:prior,baseline:input()})).body;assert.notEqual(x.sourceFingerprint,prior);assert.equal(x.source.inputFingerprint,fingerprint(input()));
 });
 for(const [path,bytes] of originals)assert.deepEqual(readFileSync(new URL('../'+path,import.meta.url)),bytes,path+' unchanged');
});

test('invalid, overlarge and deeply nested imports leave the existing source and plan untouched',async()=>{
 await desk(async({state,post,url})=>{
  const before=await state(),make=edit=>{const x=input();edit(x);return x;};
  const invalid=[make(x=>x.jobs.push(structuredClone(x.jobs[0]))),make(x=>x.jobs[1].operations[0].id='CUT_A'),make(x=>x.jobs[0].release=1),make(x=>x.jobs[0].operations[0].duration=0),make(x=>x.jobs[0].operations[0].duration=1441),make(x=>x.jobs[0].deadline=1441),make(x=>x.outages[0].end=1e20),make(x=>x.machines=['M1','M3']),make(x=>x.outages=Array.from({length:33},()=>({machine:'M1',start:1,end:2}))),make(x=>x.jobs[0].operations=Array.from({length:13},()=>({id:'DUP',machine:'M1',duration:1}))),make(x=>x.jobs=[]),make(x=>x.revision='x'.repeat(41))];
  for(const baseline of invalid){assert.equal((await post('import',{sourceFingerprint:before.sourceFingerprint,baseline})).code,400);const after=await state();assert.equal(after.version,before.version);assert.equal(after.sourceFingerprint,before.sourceFingerprint);assert.deepEqual(after.baseline,before.baseline);}
  const deep=JSON.parse('{"nest":'.repeat(10)+'0'+'}'.repeat(10));assert.equal((await post('import',{sourceFingerprint:before.sourceFingerprint,baseline:deep})).body.error,'input_shape_limit');
  const response=await fetch(url+'/api/import',{method:'POST',body:' '.repeat(16001)});assert.equal(response.status,413);
  const many=make(x=>x.jobs[0].operations=Array.from({length:13},()=>({id:'DUP',machine:'M1',duration:1})));assert.equal(solve(many).status,'INVALID');assert.equal(verify(many,[]).status,'INVALID');
 });
});

test('separate CPU grammar cases use arbitrary IDs and exact spans; unknown residue, duplicate IDs and unsupported shapes never become READY',()=>{
 const base=input(),text='Add urgent EXTRA: FIRST on M2 for 2 minutes, then LAST on M1 for 1 minute; complete EXTRA by minute 15.';
 const p=ruleProposal(base,text);assert.equal(p.status,'READY');assert.equal(validateInterpretation(base,p).valid,true);assert.deepEqual(p.changes[0].phrase,{start:0,end:text.length-1,text:text.slice(0,-1)});
 const manual=manualProposal(base,{type:'add_job',id:'EXTRA',operation1:'FIRST',operation2:'LAST',machine1:'M2',duration1:2,machine2:'M1',duration2:1,deadline:15});
 assert.deepEqual(applyConfirmed(base,p).jobs,applyConfirmed(base,manual).jobs);const changed=applyConfirmed(base,p),plan=solve(changed);assert.equal(plan.status,'OPTIMAL');assert.equal(verify(changed,plan.schedule,{reportedMakespan:plan.makespan}).status,'VALID');
 for(const request of [text.replace('complete EXTRA','complete OTHER'),text.replace('Add urgent EXTRA','Add urgent ORDER_A'),text.replace('FIRST on','CUT_A on'),text.replace('LAST on','FIRST on'),text.replace('; complete EXTRA by minute 15',''),text+' also optimize throughput.',text+' Make M1 unavailable from minute 1 to minute 2. Make M2 unavailable from minute 4 to minute 5.',text.replace('M2','M3'),text.replace('2 minutes','2.5 minutes')]){
  const candidate=ruleProposal(base,request);assert.notEqual(candidate.status,'READY',request);assert.equal(validateInterpretation(base,{...candidate,status:'READY'}).valid,false,request);
 }
 const full=input();full.jobs=[{id:'CHAIN',release:0,operations:Array.from({length:11},(_,i)=>({id:'STEP_'+i,machine:i%2?'M1':'M2',duration:1}))}];assert.notEqual(ruleProposal(full,text).status,'READY');assert.equal(validateInterpretation(full,ruleProposal(full,text)).valid,false);
 for(const edit of [x=>x.jobs[0].operations[0].duration=Infinity,x=>x.jobs[0].deadline=NaN,x=>x.outages[0].end=Infinity,x=>x.revision=Infinity]){const x=input();edit(x);assert.ok(validateScenario(x).length);assert.equal(verify(x,[]).status,'INVALID');}
});

test('infeasible imported baseline is reported honestly and never receives a feasible verifier label',async()=>{
 await desk(async({state,post})=>{const before=await state(),baseline=input();baseline.jobs[0].deadline=1;const x=(await post('import',{sourceFingerprint:before.sourceFingerprint,baseline})).body;assert.equal(x.baseline.status,'INFEASIBLE');assert.equal(x.baselineVerification.status,'NOT_RUN');assert.equal(x.baseline.makespan,undefined);});
});
