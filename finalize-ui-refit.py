import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
digest=lambda b:hashlib.sha256(b).hexdigest()
snapshot=json.loads((ROOT/'artifacts/source-snapshot.json').read_text())
frozen={name:{'expected':sha,'actual':digest((ROOT/name).read_bytes()),'unchanged':sha==digest((ROOT/name).read_bytes())} for name,sha in snapshot['sourceFileDigests'].items()}
assert all(x['unchanged'] for x in frozen.values())
tracked=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines()
protected=[name for name in tracked if name in ['planner.mjs','verifier.mjs','server.mjs','chart-layout.mjs','package.json','gold.json','fixture.mjs','interpretation.mjs','interpretation-cases.json','model_client.py','evaluate.mjs'] or name.startswith('artifacts/model-') or name in ['artifacts/runtime-provenance.json','artifacts/source-snapshot.json','artifacts/baseline-executions.json','artifacts/planner-executions.json']]
unchanged={name:digest((ROOT/name).read_bytes())==digest(subprocess.check_output(['git','show','HEAD:'+name],cwd=ROOT)) for name in protected}
assert all(unchanged.values())
assets=[]
for path in sorted((ROOT/'artifacts/ui-refit').iterdir()):
    if path.name=='provenance.json':continue
    content=path.read_bytes();assets.append({'path':str(path.relative_to(ROOT)),'bytes':len(content),'sha256':digest(content),'source':'actual browser capture' if path.suffix in ['.png','.mp4'] else 'actual local browser assertions'})
video=json.loads(subprocess.check_output(['ffprobe','-v','quiet','-print_format','json','-show_format','-show_streams',str(ROOT/'artifacts/ui-refit/scenario-review-current.mp4')]))
result={'purpose':'Presentation-only UI refit; no new inference','modelCalls':0,'gpuCalls':0,'frozenEvaluationSources':frozen,'protectedOriginalFilesUnchanged':unchanged,'assets':assets,'video':{'durationSeconds':float(video['format']['duration']),'width':video['streams'][0]['width'],'height':video['streams'][0]['height'],'codec':video['streams'][0]['codec_name'],'capture':'Actual automated desktop Chrome UI actions; separate mobile screenshot; no generated logs or narration'},'uiFiles':{name:digest((ROOT/name).read_bytes()) for name in ['index.html','app.mjs','style.css']}}
(ROOT/'artifacts/ui-refit/provenance.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'assets':len(assets),'protectedFiles':len(protected),'allUnchanged':all(unchanged.values()),'videoSeconds':result['video']['durationSeconds']}))
