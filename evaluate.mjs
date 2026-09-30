import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {scenario,fingerprint} from './fixture.mjs';
import {ruleProposal,manualProposal,validateInterpretation} from './interpretation.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const FROZEN_GOLD_COMMIT='a188c88';
const SOURCE_FILES=['fixture.mjs','interpretation.mjs','interpretation-cases.json','gold.json','model_client.py','evaluate.mjs'];
export const digest=text=>createHash('sha256').update(text).digest('hex');
const equal=(a,b)=>fingerprint(a)===fingerprint(b);
const object=p=>!!p&&typeof p==='object'&&!Array.isArray(p);
const exists=async file=>{try{await access(file);return true;}catch{return false;}};

export async function prepare(root=ROOT){
 const dir=path.join(root,'artifacts');await mkdir(dir,{recursive:true});
 for(const name of ['model-input.json','source-snapshot.json','model-evaluation.json','model-attempts'])if(await exists(path.join(dir,name)))throw Error('archive_exists_no_overwrite: '+name);
 const frozen=JSON.parse(await readFile(path.join(root,'interpretation-cases.json'),'utf8'));
 if(!equal(frozen.cases.map(c=>c.id),Array.from({length:12},(_,i)=>`E${i+1}`))||!equal(frozen.cases.filter(c=>c.expectedStatus==='READY').map(c=>c.id),['E1','E2','E6']))throw Error('frozen_cases_changed');
 const base=scenario();const modelInput={scenario:base,sourceFingerprint:fingerprint(base),cases:frozen.cases.map(({id,text})=>({id,text}))};
 const inputText=JSON.stringify(modelInput,null,2)+'\n';
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const sourceWorktree=execFileSync('git',['status','--porcelain','--',...SOURCE_FILES],{cwd:root,encoding:'utf8'}).trim();
 const sourceFileDigests={};for(const name of SOURCE_FILES)sourceFileDigests[name]=digest(await readFile(path.join(root,name)));
 // Verify the original mathematical gold predates every model prompt.
 const originalGold=execFileSync('git',['show',`${FROZEN_GOLD_COMMIT}:gold.json`],{cwd:root});
 if(digest(originalGold)!==sourceFileDigests['gold.json'])throw Error('frozen_mathematical_gold_changed');
 const snapshot={schemaVersion:1,preparedAt:new Date().toISOString(),sourceCommit,sourceWorktree,frozenGoldCommit:FROZEN_GOLD_COMMIT,sourceFileDigests,modelInputDigest:digest(inputText),modelInput,evaluationCases:frozen.cases,split:{development:0,evaluation:12},limits:{model:'qwen3:4b',context:4096,output:640,timeoutSeconds:60,concurrency:1,temperature:0,seed:42,think:false}};
 await writeFile(path.join(dir,'model-input.json'),inputText,{flag:'wx'});
 await writeFile(path.join(dir,'source-snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
 return snapshot;
}

export function requestMatches(snapshot,record,caseId,snapshotDigest){
 try{
  const c=snapshot.modelInput.cases.find(c=>c.id===caseId),p=record.request;
  if(!c||record.caseId!==caseId||record.phase!=='evaluation'||record.developmentCalls!==0||record.sourceCommit!==snapshot.sourceCommit||record.modelInputDigest!==snapshot.modelInputDigest||record.snapshotDigest!==snapshotDigest)return false;
  if(record.model!=='qwen3:4b'||record.contextLimit!==4096||record.outputLimit!==640||record.timeoutSeconds!==60||record.concurrency!==1)return false;
  if(!object(p)||p.model!=='qwen3:4b'||p.stream!==false||p.think!==false||p.truncate!==false||p.shift!==false||!equal(p.options,{num_ctx:4096,num_predict:640,temperature:0,seed:42}))return false;
  if(!Array.isArray(p.messages)||p.messages.length!==2||p.messages[0].role!=='system'||typeof p.messages[0].content!=='string'||p.messages[1].role!=='user')return false;
  return equal(JSON.parse(p.messages[1].content),{scenario:snapshot.modelInput.scenario,sourceFingerprint:snapshot.modelInput.sourceFingerprint,case:c});
 }catch{return false;}
}

export function schemaIssues(p){
 if(!object(p))return ['Proposal object required.'];
 const issues=[];
 const keys=['status','sourceFingerprint','sourceText','unit','origin','changes','unsupportedClauses','issues'];
 if(!equal(Object.keys(p).sort(),keys.sort()))issues.push('Incomplete or extra proposal fields.');
 if(!['READY','CLARIFY','UNSUPPORTED','INVALID'].includes(p.status)||typeof p.sourceFingerprint!=='string'||typeof p.sourceText!=='string'||p.unit!=='minute'||p.origin!==0)issues.push('Invalid status/source/convention.');
 if(!Array.isArray(p.changes)||p.changes.length>2||!Array.isArray(p.unsupportedClauses)||!Array.isArray(p.issues)||!p.issues.every(x=>typeof x==='string'))issues.push('Typed arrays required.');
 if(p.status==='READY'&&Array.isArray(p.issues)&&p.issues.length)issues.push('READY cannot retain unresolved issues.');
 const span=s=>object(s)&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&typeof s.text==='string'&&typeof p.sourceText==='string'&&s.end<=p.sourceText.length&&p.sourceText.slice(s.start,s.end)===s.text;
 for(const c of Array.isArray(p.changes)?p.changes:[]){
  if(!object(c)||!span(c.phrase)||c.unit!=='minute'||c.origin!==0){issues.push('Change convention and exact phrase span required.');continue;}
  if(c.type==='add_outage'){
   if(!equal(Object.keys(c).sort(),['type','machine','start','end','unit','origin','phrase'].sort())||!['M1','M2'].includes(c.machine)||!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end<=c.start||c.end>30)issues.push('Invalid outage.');
  }else if(c.type==='add_job'){
   if(!equal(Object.keys(c).sort(),['type','id','release','operations','deadline','unit','origin','phrase'].sort())||c.id!=='J4'||c.release!==0||!Number.isInteger(c.deadline)||c.deadline<1||c.deadline>30||!Array.isArray(c.operations)||c.operations.length!==2)issues.push('Invalid job.');
   for(const [i,o]of (Array.isArray(c.operations)?c.operations:[]).entries())if(!object(o)||!equal(Object.keys(o).sort(),['id','machine','duration'].sort())||o.id!==['J4A','J4B'][i]||!['M1','M2'].includes(o.machine)||!Number.isInteger(o.duration)||o.duration<1||o.duration>10)issues.push('Invalid operation.');
  }else issues.push('Unknown change type.');
 }
 for(const c of Array.isArray(p.unsupportedClauses)?p.unsupportedClauses:[])if(!span(c)||typeof c.reason!=='string'||!c.reason.trim()||!equal(Object.keys(c).sort(),['start','end','text','reason'].sort()))issues.push('Exact unsupported clause and reason required.');
 return issues;
}

export function evaluateAttempt(base,snapshot,record,caseId,snapshotDigest){
 const entry={id:caseId,status:record?.status??'missing',requestMatch:false,parseState:'not-run',validation:{valid:false,status:'INVALID',issues:['No complete bound proposal.']}};
 if(!object(record)){entry.parseState='malformed-attempt';return entry;}
 entry.requestMatch=requestMatches(snapshot,record,caseId,snapshotDigest);
 let p;
 try{
  if(typeof record.raw?.message?.content!=='string')throw Error('missing-content');
  p=JSON.parse(record.raw.message.content);entry.proposal=p;
  entry.parseState='valid-json';
 }catch(e){entry.parseState=e.message;return entry;}
 const c=snapshot.modelInput.cases.find(c=>c.id===caseId);
 const issues=schemaIssues(p);
 if(record.status!=='complete'||record.raw?.done!==true||record.raw?.done_reason==='length')issues.push('Incomplete output.');
 if(!entry.requestMatch)issues.push('Archived request/input/snapshot provenance mismatch.');
 if(!c||p?.sourceText!==c.text||p?.sourceFingerprint!==snapshot.modelInput.sourceFingerprint)issues.push('Proposal is not bound to its original source text and fingerprint.');
 if(issues.length){entry.validation={valid:false,status:'INVALID',issues};return entry;}
 // Keep the original proposal and fingerprint; changed fixtures must be STALE.
 entry.validation=validateInterpretation(base,p);
 return entry;
}

export function score(cases,expected){
 const supported=new Set(expected.filter(c=>c.expectedStatus==='READY').map(c=>c.id));
 let correct=0,falseReady=0,rawReady=0,acceptedReady=0,wrongReady=0,missedSupported=0;
 for(const c of cases){const e=expected.find(e=>e.id===c.id);if(!e)continue;
  if(c.proposal?.status===e.expectedStatus)correct++;
  if(c.proposal?.status==='READY'){rawReady++;if(!supported.has(c.id))falseReady++;}
  if(c.validation?.valid&&c.validation.status==='READY'){acceptedReady++;if(!supported.has(c.id))wrongReady++;}
  else if(supported.has(c.id))missedSupported++;
 }
 return {denominator:expected.length,raw:{correct,statusAccuracy:correct/expected.length,ready:rawReady,falseReady},guarded:{acceptedReady,wrongReady,missedSupported}};
}

export async function evaluate(root=ROOT){
 const dir=path.join(root,'artifacts');
 const snapshotText=await readFile(path.join(dir,'source-snapshot.json'),'utf8'),snapshot=JSON.parse(snapshotText);
 const inputText=await readFile(path.join(dir,'model-input.json'),'utf8');
 if(digest(inputText)!==snapshot.modelInputDigest||!equal(JSON.parse(inputText),snapshot.modelInput))throw Error('model_input_digest_mismatch');
 const snapshotDigest=digest(snapshotText),base=scenario(),attempts=[],cases=[];
 let files=[];try{files=(await readdir(path.join(dir,'model-attempts'))).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const filename of files){
  const rawFile=await readFile(path.join(dir,'model-attempts',filename),'utf8');
  let record;try{record=JSON.parse(rawFile);}catch{attempts.push({filename,rawFile,status:'malformed-attempt'});continue;}
  attempts.push({filename,record});
 }
 for(const c of snapshot.evaluationCases){
  const matches=attempts.filter(a=>a.filename===c.id+'.json');
  const entry=evaluateAttempt(base,snapshot,matches[0]?.record,c.id,snapshotDigest);
  if(matches.length!==1){entry.validation={valid:false,status:'INVALID',issues:['Exactly one preserved attempt required.']};}
  cases.push(entry);
 }
 const rules=snapshot.evaluationCases.map(c=>{const proposal=ruleProposal(base,c.text);return {id:c.id,proposal,validation:validateInterpretation(base,proposal)};});
 const formInputs=[{id:'E1',input:{type:'add_outage',machine:'M1',start:2,end:4}},{id:'E2',input:{type:'add_job',machine1:'M2',duration1:1,machine2:'M1',duration2:1,deadline:4}},{id:'E6',input:{type:'add_outage',machine:'M1',start:2,end:4}}];
 const forms=formInputs.map(({id,input})=>{const proposal=manualProposal(base,input);return {id,input,proposal,validation:validateInterpretation(base,proposal)};});
 const result={schemaVersion:1,sourceCommit:snapshot.sourceCommit,snapshotDigest,modelInputDigest:snapshot.modelInputDigest,frozenGoldCommit:snapshot.frozenGoldCommit,currentSourceFingerprint:fingerprint(base),archivedSourceFingerprint:snapshot.modelInput.sourceFingerprint,split:snapshot.split,limits:snapshot.limits,evaluationAttempts:attempts.length,httpRequestAttempts:attempts.filter(a=>a.record?.httpRequestAttempted===true).length,completedResponses:attempts.filter(a=>a.record?.status==='complete').length,humanAcceptedModelProposals:0,model:score(cases,snapshot.evaluationCases),ruleParser:score(rules,snapshot.evaluationCases),manualForm:{denominator:3,scope:'Three explicit supported typed inputs; no natural-language accuracy claim.',acceptedReady:forms.filter(f=>f.validation.valid).length,cases:forms},actualMetrics:attempts.map(a=>({filename:a.filename,caseId:a.record?.caseId,status:a.record?.status??a.status,elapsedMs:a.record?.elapsedMs??null,promptEvalCount:a.record?.raw?.prompt_eval_count??null,evalCount:a.record?.raw?.eval_count??null,totalDurationNs:a.record?.raw?.total_duration??null,loadDurationNs:a.record?.raw?.load_duration??null,promptEvalDurationNs:a.record?.raw?.prompt_eval_duration??null,evalDurationNs:a.record?.raw?.eval_duration??null,doneReason:a.record?.raw?.done_reason??null,error:a.record?.error??null})),cases,attempts};
 await writeFile(path.join(dir,'model-evaluation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=process.argv.includes('--prepare')?await prepare():await evaluate();
 console.log(JSON.stringify(process.argv.includes('--prepare')?{prepared:true,sourceCommit:result.sourceCommit,modelInputDigest:result.modelInputDigest,split:result.split}:{model:result.model,ruleParser:result.ruleParser,manualForm:result.manualForm.acceptedReady,evaluationAttempts:result.evaluationAttempts,httpRequestAttempts:result.httpRequestAttempts},null,2));
}
