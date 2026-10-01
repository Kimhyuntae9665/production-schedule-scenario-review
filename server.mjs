import http from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {scenario,fingerprint} from './fixture.mjs';import {solve,validateScenario} from './planner.mjs';import {verify} from './verifier.mjs';import {ruleProposal,manualProposal,validateInterpretation,applyConfirmed,receipt} from './interpretation.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const check=(data,plan)=>plan.schedule.length?verify(data,plan.schedule,{reportedMakespan:plan.makespan}):{status:'NOT_RUN',issues:['No feasible incumbent to verify.']};
// Reject nested/oversized transport shapes before hashing, cloning or planning.
function boundedRequest(input){
 const queue=[[input,0]];let entries=0;
 while(queue.length){const [value,depth]=queue.pop();if(depth>8||++entries>1000)return false;if(value&&typeof value==='object'){const values=Object.values(value);if(values.length>1000)return false;for(const child of values)queue.push([child,depth+1]);}}
 return input!==null&&typeof input==='object'&&!Array.isArray(input);
}
export function recordedProposal(entry,base){
 if(!entry?.proposal)return {...ruleProposal(base,''),status:'MODEL_UNAVAILABLE',issues:['No recorded proposal for this case. Manual form remains usable.']};
 const p={...entry.proposal,method:'recorded-qwen3:4b'};
 if(entry.requestMatch!==true||entry.status!=='complete'||entry.parseState!=='valid-json'||entry.validation?.valid!==true)return {...ruleProposal(base,''),method:'recorded-qwen3:4b',sourceFingerprint:typeof p.sourceFingerprint==='string'?p.sourceFingerprint:fingerprint(base),sourceText:typeof p.sourceText==='string'?p.sourceText:'',status:'ARCHIVE_REJECTED',archivedProposal:entry.proposal,issues:['Archived attempt did not pass complete-output, schema and source-provenance checks. Its original output is retained separately; use the manual form for a fresh proposal.',...(Array.isArray(entry.validation?.issues)?entry.validation.issues.filter(x=>typeof x==='string'):[])]};
 return p;
}
export function createDesk(){
 let base=scenario(),baseline=solve(base),baselineVerification=check(base,baseline),proposal=null,changed=null,changedPlan=null,changedVerification=null,history=[],latestReceipt=null,version=0,planFingerprint=null,plannedProposalId=null,plannedBudget=null,plannedProposal=null;
 let sourceRevision=1,source={kind:'synthetic-fixture',label:'Synthetic fixture A'};
 const clearPlan=()=>{changed=null;changedPlan=null;changedVerification=null;planFingerprint=null;plannedProposalId=null;plannedProposal=null;plannedBudget=null;};
 const receiptCompatibility=()=>({current:!!latestReceipt&&latestReceipt.sourceFingerprint===fingerprint(base)&&latestReceipt.planFingerprint===planFingerprint&&latestReceipt.proposal.id===proposal?.id,proposalId:latestReceipt?.proposal.id??null,reason:!latestReceipt?'No receipt':latestReceipt.sourceFingerprint!==fingerprint(base)?'Historical receipt; source baseline/calendar changed. It does not verify the current scenario.':latestReceipt.planFingerprint!==planFingerprint?'Historical receipt; plan fingerprint changed. Review the new result.':latestReceipt.proposal.id!==proposal?.id?'Previous confirmed plan receipt; it belongs to a different proposal than the one currently inspected.':'Compatible with current proposal, source and exact plan'});
 const state=()=>({version,base,baseline,baselineVerification,source,sourceRevision,sourceFingerprint:fingerprint(base),proposal:proposal?{...proposal,validation:validateInterpretation(base,proposal)}:null,changed,changedPlan,changedVerification,planFingerprint,plannedProposalId,plannedProposal,planIsCurrent:!!changedPlan&&plannedProposalId===proposal?.id,history,latestReceipt,receiptCompatibility:receiptCompatibility(),modelState:'CPU calculation only. Frozen Qwen archive: 0/12 usable proposals. No live inference or model transmission.'});
 return http.createServer(async(req,res)=>{
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(req.method==='GET'&&path==='/api/state')return json(200,state());
   if(req.method==='GET'&&path==='/api/receipt'){if(!latestReceipt)return json(404,{error:'receipt_unavailable'});res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="local-scenario-review.json"'});return res.end(JSON.stringify({receipt:latestReceipt,compatibility:receiptCompatibility()},null,2));}
   if(req.method==='POST'&&path.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'origin_rejected'});
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16000)return json(413,{error:'body_limit',message:'Request exceeds 16,000 bytes.'});chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    if(!boundedRequest(input))return json(400,{error:'input_shape_limit',message:'Request must be a bounded object (depth <= 8, entries <= 1000).'});
    if(['propose','import','calendar','reset'].includes(path.slice(5))&&input.sourceFingerprint!==fingerprint(base))return json(409,{error:'stale_source',message:'Source changed or fingerprint missing; reload and inspect the current source before continuing.'});
    if(path==='/api/propose'){
     const inspectedSource=fingerprint(base);let nextProposal;
     if(input.method==='manual')nextProposal=manualProposal(base,input.input||{});
     else if(input.method==='recorded'){
      try{const evaluation=JSON.parse(await readFile(root+'artifacts/model-evaluation.json','utf8'));nextProposal=recordedProposal(evaluation.cases.find(c=>c.id===input.caseId),base);}catch{nextProposal=recordedProposal(null,base);}
     }else nextProposal=ruleProposal(base,input.text||'');
     if(inspectedSource!==fingerprint(base))return json(409,{error:'stale_source',message:'Source changed while preparing the proposal; inspect again.'});
     proposal={...nextProposal,id:randomUUID()};proposal.proposalHash=fingerprint(proposal);history.push({event:'proposed',id:proposal.id,status:proposal.status});version++;
    }else if(path==='/api/confirm'){
     if(!proposal||input.proposalId!==proposal.id||input.proposalHash!==proposal.proposalHash||input.sourceFingerprint!==proposal.sourceFingerprint)return json(409,{error:'stale_inspection',message:'Proposal changed; inspect the latest interpretation before confirming.'});
     const v=validateInterpretation(base,proposal);if(!v.valid)return json(409,{error:v.status,message:v.issues.join(' ')});
     if(input.confirmConvention!==true)return json(409,{error:'convention_confirmation_required'});
     if(plannedProposalId===proposal.id&&plannedBudget===(input.budget||'complete'))return json(200,state());
     const options={complete:{maxSequences:10000,timeoutMs:1000},limited:{maxSequences:1,timeoutMs:1000},horizon6:{horizon:6,maxSequences:10000,timeoutMs:1000}}[input.budget||'complete'];if(!options)return json(400,{error:'unknown_budget'});
     changed=applyConfirmed(base,proposal);changedPlan=solve(changed,options);changedVerification=check(changed,changedPlan);
     planFingerprint=fingerprint({scenario:changed,plan:changedPlan,verification:changedVerification});plannedProposalId=proposal.id;plannedProposal=structuredClone(proposal);plannedBudget=input.budget||'complete';history.push({event:'confirmed_and_planned',id:proposal.id,solverStatus:changedPlan.status,verifierStatus:changedVerification.status,planFingerprint});version++;
    }else if(path==='/api/review'){
     if(!proposal||!changedPlan||plannedProposalId!==proposal.id||input.proposalId!==proposal.id||input.proposalHash!==proposal.proposalHash||input.sourceFingerprint!==fingerprint(base)||input.planFingerprint!==planFingerprint||!validateInterpretation(base,proposal).valid)return json(409,{error:'stale_plan_inspection',message:'Proposal or plan changed; inspect the current result before recording a review.'});
     if(latestReceipt?.proposal.id===proposal.id&&latestReceipt.planFingerprint===planFingerprint)return json(200,state());
     latestReceipt=receipt(changed,proposal,changedPlan,changedVerification,latestReceipt?.hash??null);history.push({event:'plan_reviewed',id:proposal.id,solverStatus:changedPlan.status,verifierStatus:changedVerification.status,receiptHash:latestReceipt.hash});version++;
    }else if(path==='/api/reject'){
     if(proposal)history.push({event:'rejected',id:proposal.id,sourceFingerprint:proposal.sourceFingerprint});proposal=null;version++;
    }else if(path==='/api/calendar'){
     const next=structuredClone(base);next.revision=sourceRevision+1;next.outages.push({machine:'M2',start:8,end:9});const issues=validateScenario(next);if(issues.length)return json(400,{error:'invalid_baseline',message:issues.join(' ')});
     base=next;sourceRevision++;baseline=solve(base);baselineVerification=check(base,baseline);clearPlan();history.push({event:'calendar_changed',sourceFingerprint:fingerprint(base),sourceRevision});version++;
    }else if(path==='/api/import'){
     const issues=validateScenario(input.baseline);if(issues.length)return json(400,{error:'invalid_baseline',message:issues.join(' '),issues});
     const next=structuredClone(input.baseline);next.revision=sourceRevision+1;const nextPlan=solve(next),nextVerification=check(next,nextPlan);
     if(nextPlan.status==='INVALID'||nextVerification.status==='INVALID')return json(400,{error:'invalid_baseline',message:'Baseline failed planner or independent verification.'});
     source={kind:'user-input',label:'Local user-supplied baseline',inputFingerprint:fingerprint(input.baseline),suppliedRevision:input.baseline.revision};sourceRevision++;base=next;baseline=nextPlan;baselineVerification=nextVerification;proposal=null;clearPlan();history.push({event:'baseline_imported',sourceFingerprint:fingerprint(base),sourceRevision,inputFingerprint:source.inputFingerprint});version++;
    }else if(path==='/api/reset'){
     base=scenario();base.revision=++sourceRevision;source={kind:'synthetic-fixture',label:'Synthetic fixture A'};baseline=solve(base);baselineVerification=check(base,baseline);proposal=null;clearPlan();history.push({event:'synthetic_reset',sourceFingerprint:fingerprint(base),sourceRevision});version++;
    }else return json(404,{error:'unknown_action'});return json(200,state());
   }
   const file={'/':'index.html','/app.mjs':'app.mjs','/chart-layout.mjs':'chart-layout.mjs','/style.css':'style.css'}[path];if(!file)return json(404,{error:'not_found'});
   res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html':file.endsWith('css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(await readFile(root+file));
  }catch(e){json(400,{error:'request_rejected',message:e.message});}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url))createDesk().listen(Number(process.env.PORT||5077),'127.0.0.1',()=>console.log('P07 local review desk ready'));
