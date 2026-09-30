import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scenario,fingerprint} from '../fixture.mjs';
import {ruleProposal} from '../interpretation.mjs';
import {digest,evaluateAttempt,score,evaluate,schemaIssues} from '../evaluate.mjs';

const frozen=JSON.parse(await readFile(new URL('../interpretation-cases.json',import.meta.url),'utf8'));
const base=scenario();
const modelInput={scenario:base,sourceFingerprint:fingerprint(base),cases:frozen.cases.map(({id,text})=>({id,text}))};
const inputText=JSON.stringify(modelInput,null,2)+'\n';
const snapshot={sourceCommit:'pre-inference-commit',modelInputDigest:digest(inputText),modelInput,evaluationCases:frozen.cases,frozenGoldCommit:'a188c88',split:{development:0,evaluation:12},limits:{model:'qwen3:4b',context:4096,output:640,timeoutSeconds:60,concurrency:1,temperature:0,seed:42,think:false}};
const snapshotText=JSON.stringify(snapshot,null,2)+'\n';
const snapshotDigest=digest(snapshotText);
const proposalFor=id=>{const p=ruleProposal(base,modelInput.cases.find(c=>c.id===id).text);delete p.method;return p;};
const recordFor=(id='E1',p=proposalFor(id))=>({caseId:id,phase:'evaluation',developmentCalls:0,model:'qwen3:4b',contextLimit:4096,outputLimit:640,timeoutSeconds:60,concurrency:1,sourceCommit:snapshot.sourceCommit,modelInputDigest:snapshot.modelInputDigest,snapshotDigest,httpRequestAttempted:true,status:'complete',raw:{done:true,done_reason:'stop',message:{content:JSON.stringify(p)},eval_count:42},request:{model:'qwen3:4b',stream:false,think:false,truncate:false,shift:false,options:{num_ctx:4096,num_predict:640,temperature:0,seed:42},messages:[{role:'system',content:'bounded mock instruction'},{role:'user',content:JSON.stringify({scenario:base,sourceFingerprint:fingerprint(base),case:modelInput.cases.find(c=>c.id===id)})}]}});

test('bound supported archive validates and preserves original source',()=>{
 const result=evaluateAttempt(base,snapshot,recordFor(),'E1',snapshotDigest);
 assert.equal(result.validation.valid,true);assert.equal(result.requestMatch,true);assert.deepEqual(result.proposal,proposalFor('E1'));
});
test('case text, request source, input digest and snapshot digest cannot be rebound',()=>{
 for(const mutate of [r=>r.caseId='E2',r=>r.modelInputDigest='new',r=>r.snapshotDigest='new',r=>r.sourceCommit='new',r=>r.request.messages[1].content=JSON.stringify({scenario:base,sourceFingerprint:fingerprint(base),case:modelInput.cases[1]})]){
  const r=recordFor();mutate(r);const e=evaluateAttempt(base,snapshot,r,'E1',snapshotDigest);assert.equal(e.validation.valid,false);assert.equal(e.requestMatch,false);
 }
 const p=proposalFor('E1');p.sourceText=modelInput.cases[1].text;
 assert.equal(evaluateAttempt(base,snapshot,recordFor('E1',p),'E1',snapshotDigest).validation.valid,false);
});
test('changed calendar retains old proposal and returns STALE',()=>{
 const current=structuredClone(base);current.revision='2';current.outages.push({machine:'M2',start:8,end:9});
 const e=evaluateAttempt(current,snapshot,recordFor(),'E1',snapshotDigest);
 assert.equal(e.validation.status,'STALE');assert.equal(e.proposal.sourceFingerprint,fingerprint(base));assert.notEqual(e.proposal.sourceFingerprint,fingerprint(current));
});
test('null, primitive, malformed, missing and incomplete model responses are explicit failures',()=>{
 for(const value of [null,[],42,'text',{}]){
  const e=evaluateAttempt(base,snapshot,recordFor('E1',value),'E1',snapshotDigest);assert.equal(e.validation.valid,false);
 }
 for(const mutate of [r=>r.raw.message.content='{',r=>r.raw=null,r=>r.status='failed-attempt',r=>r.raw.done=false,r=>r.raw.done_reason='length']){
  const r=recordFor();mutate(r);assert.equal(evaluateAttempt(base,snapshot,r,'E1',snapshotDigest).validation.valid,false);
 }
 assert.equal(evaluateAttempt(base,snapshot,null,'E1',snapshotDigest).parseState,'malformed-attempt');
});
test('truncated schemas, wrong spans, extra executable fields and unsupported residue fail closed',()=>{
 for(const mutate of [p=>delete p.issues,p=>p.changes[0].phrase.end--,p=>p.code='print(1)',p=>p.changes[0].machine='Press',p=>p.changes[0].origin=1]){
  const p=proposalFor('E1');mutate(p);assert.ok(schemaIssues(p).length);assert.equal(evaluateAttempt(base,snapshot,recordFor('E1',p),'E1',snapshotDigest).validation.valid,false);
 }
 const p=proposalFor('E8');p.status='READY';p.unsupportedClauses=[];
 const e=evaluateAttempt(base,snapshot,recordFor('E8',p),'E8',snapshotDigest);assert.equal(e.validation.valid,false);assert.equal(e.validation.status,'UNSUPPORTED');
});
test('raw false READY and guarded accepted READY use separate denominators',()=>{
 const cases=frozen.cases.map(c=>evaluateAttempt(base,snapshot,recordFor(c.id),c.id,snapshotDigest));
 const p=proposalFor('E8');p.status='READY';p.unsupportedClauses=[];cases[7]=evaluateAttempt(base,snapshot,recordFor('E8',p),'E8',snapshotDigest);
 const result=score(cases,frozen.cases);assert.equal(result.raw.correct,11);assert.equal(result.raw.falseReady,1);assert.equal(result.guarded.acceptedReady,3);assert.equal(result.guarded.wrongReady,0);assert.equal(result.guarded.missedSupported,0);
});
test('post-evaluation preserves malformed files, failed attempts, missing cases and metrics without overwrite',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'p07-eval-'));
 try{
  const dir=path.join(root,'artifacts');await mkdir(path.join(dir,'model-attempts'),{recursive:true});
  await writeFile(path.join(dir,'source-snapshot.json'),snapshotText);await writeFile(path.join(dir,'model-input.json'),inputText);
  const r=recordFor();await writeFile(path.join(dir,'model-attempts','E1.json'),JSON.stringify(r));
  await writeFile(path.join(dir,'model-attempts','E2.json'),'{truncated');
  const failed=recordFor('E3');failed.status='failed-attempt';failed.error='inference_busy';failed.httpRequestAttempted=false;failed.raw=null;
  await writeFile(path.join(dir,'model-attempts','E3.json'),JSON.stringify(failed));
  const result=await evaluate(root);assert.equal(result.cases.length,12);assert.equal(result.evaluationAttempts,3);assert.equal(result.httpRequestAttempts,1);assert.equal(result.model.guarded.acceptedReady,1);assert.equal(result.model.guarded.missedSupported,2);
  assert.equal(result.manualForm.denominator,3);assert.equal(result.manualForm.acceptedReady,3);assert.equal(result.ruleParser.raw.correct,12);assert.equal(result.attempts[1].rawFile,'{truncated');assert.deepEqual(result.attempts[0].record,r);assert.equal(result.actualMetrics[0].evalCount,42);
  await assert.rejects(evaluate(root),{code:'EEXIST'});
 }finally{await rm(root,{recursive:true,force:true});}
});
