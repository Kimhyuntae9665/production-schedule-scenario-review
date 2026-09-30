import http from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {scenario,fingerprint} from './fixture.mjs';import {solve} from './planner.mjs';import {verify} from './verifier.mjs';import {ruleProposal,manualProposal,validateInterpretation,applyConfirmed,receipt} from './interpretation.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const check=(data,plan)=>plan.schedule.length?verify(data,plan.schedule,{reportedMakespan:plan.makespan}):{status:'NOT_RUN',issues:['No feasible incumbent to verify.']};
export function recordedProposal(entry,base){
 if(!entry?.proposal)return {...ruleProposal(base,''),status:'MODEL_UNAVAILABLE',issues:['No recorded proposal for this case. Manual form remains usable.']};
 const p={...entry.proposal,method:'recorded-qwen3:4b'};
 if(entry.requestMatch!==true||entry.status!=='complete'||entry.parseState!=='valid-json'||entry.validation?.valid!==true)return {...ruleProposal(base,''),sourceFingerprint:typeof p.sourceFingerprint==='string'?p.sourceFingerprint:fingerprint(base),sourceText:typeof p.sourceText==='string'?p.sourceText:'',status:'ARCHIVE_REJECTED',archivedProposal:p,issues:['Archived attempt did not pass complete-output, schema and source-provenance checks. Its original output is retained separately; use the manual form for a fresh proposal.']};
 return p;
}
export function createDesk(){
 let base=scenario(),baseline=solve(base),baselineVerification=check(base,baseline),proposal=null,changed=null,changedPlan=null,changedVerification=null,history=[],latestReceipt=null,version=0,planFingerprint=null,plannedProposalId=null,plannedBudget=null;
 const receiptCompatibility=()=>({current:!!latestReceipt&&latestReceipt.sourceFingerprint===fingerprint(base)&&latestReceipt.planFingerprint===planFingerprint,reason:!latestReceipt?'No receipt':latestReceipt.sourceFingerprint!==fingerprint(base)?'Historical receipt; source calendar changed. It does not verify the current scenario.':latestReceipt.planFingerprint!==planFingerprint?'Historical receipt; plan fingerprint changed. Review the new result.':'Compatible with current source and exact plan'});
 const state=()=>({version,base,baseline,baselineVerification,sourceFingerprint:fingerprint(base),proposal:proposal?{...proposal,validation:validateInterpretation(base,proposal)}:null,changed,changedPlan,changedVerification,planFingerprint,plannedProposalId,history,latestReceipt,receiptCompatibility:receiptCompatibility(),modelState:'No live inference in this desk. Recorded proposals are optional.'});
 return http.createServer(async(req,res)=>{
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(req.method==='GET'&&path==='/api/state')return json(200,state());
   if(req.method==='GET'&&path==='/api/receipt'){if(!latestReceipt)return json(404,{error:'receipt_unavailable'});res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="local-scenario-review.json"'});return res.end(JSON.stringify({receipt:latestReceipt,compatibility:receiptCompatibility()},null,2));}
   if(req.method==='POST'&&path.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'origin_rejected'});
    let text='';for await(const chunk of req){text+=chunk;if(text.length>12000)return json(413,{error:'body_limit'});}const input=JSON.parse(text||'{}');
    if(path==='/api/propose'){
     if(input.method==='manual')proposal=manualProposal(base,input.input||{});
     else if(input.method==='recorded'){
      try{const evaluation=JSON.parse(await readFile(root+'artifacts/model-evaluation.json','utf8'));proposal=recordedProposal(evaluation.cases.find(c=>c.id===input.caseId),base);}catch{proposal=recordedProposal(null,base);}
     }else proposal=ruleProposal(base,input.text||'');
     proposal={...proposal,id:randomUUID()};proposal.proposalHash=fingerprint(proposal);history.push({event:'proposed',id:proposal.id,status:proposal.status});version++;
    }else if(path==='/api/confirm'){
     if(!proposal||input.proposalId!==proposal.id||input.proposalHash!==proposal.proposalHash||input.sourceFingerprint!==proposal.sourceFingerprint)return json(409,{error:'stale_inspection',message:'Proposal changed; inspect the latest interpretation before confirming.'});
     const v=validateInterpretation(base,proposal);if(!v.valid)return json(409,{error:v.status,message:v.issues.join(' ')});
     if(input.confirmConvention!==true)return json(409,{error:'convention_confirmation_required'});
     if(plannedProposalId===proposal.id&&plannedBudget===(input.budget||'complete'))return json(200,state());
     const options={complete:{maxSequences:10000,timeoutMs:1000},limited:{maxSequences:1,timeoutMs:1000},horizon6:{horizon:6,maxSequences:10000,timeoutMs:1000}}[input.budget||'complete'];if(!options)return json(400,{error:'unknown_budget'});
     changed=applyConfirmed(base,proposal);changedPlan=solve(changed,options);changedVerification=check(changed,changedPlan);
     planFingerprint=fingerprint({scenario:changed,plan:changedPlan,verification:changedVerification});plannedProposalId=proposal.id;plannedBudget=input.budget||'complete';history.push({event:'confirmed_and_planned',id:proposal.id,solverStatus:changedPlan.status,verifierStatus:changedVerification.status,planFingerprint});version++;
    }else if(path==='/api/review'){
     if(!proposal||!changedPlan||plannedProposalId!==proposal.id||input.proposalId!==proposal.id||input.proposalHash!==proposal.proposalHash||input.sourceFingerprint!==fingerprint(base)||input.planFingerprint!==planFingerprint||!validateInterpretation(base,proposal).valid)return json(409,{error:'stale_plan_inspection',message:'Proposal or plan changed; inspect the current result before recording a review.'});
     if(latestReceipt?.proposal.id===proposal.id&&latestReceipt.planFingerprint===planFingerprint)return json(200,state());
     latestReceipt=receipt(changed,proposal,changedPlan,changedVerification,latestReceipt?.hash??null);history.push({event:'plan_reviewed',id:proposal.id,solverStatus:changedPlan.status,verifierStatus:changedVerification.status,receiptHash:latestReceipt.hash});version++;
    }else if(path==='/api/reject'){
     if(proposal)history.push({event:'rejected',id:proposal.id,sourceFingerprint:proposal.sourceFingerprint});proposal=null;version++;
    }else if(path==='/api/calendar'){
     base=structuredClone(base);base.revision=Number(base.revision)+1;base.outages.push({machine:'M2',start:8,end:9});baseline=solve(base);baselineVerification=check(base,baseline);changed=null;changedPlan=null;changedVerification=null;planFingerprint=null;plannedProposalId=null;plannedBudget=null;history.push({event:'calendar_changed',sourceFingerprint:fingerprint(base)});version++;
    }else if(path==='/api/reset'){
     base=scenario();baseline=solve(base);baselineVerification=check(base,baseline);proposal=null;changed=null;changedPlan=null;changedVerification=null;latestReceipt=null;planFingerprint=null;plannedProposalId=null;plannedBudget=null;history=[];version++;
    }else return json(404,{error:'unknown_action'});return json(200,state());
   }
   const file={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'}[path];if(!file)return json(404,{error:'not_found'});
   res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html':file.endsWith('css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(await readFile(root+file));
  }catch(e){json(400,{error:'request_rejected',message:e.message});}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url))createDesk().listen(Number(process.env.PORT||5077),'127.0.0.1',()=>console.log('P07 local review desk ready'));
