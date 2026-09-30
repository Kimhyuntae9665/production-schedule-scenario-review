"""Report paths/counts only; never print potential secrets."""
import re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
patterns=[re.compile(rb'gh[pousr]_[A-Za-z0-9]{20,}'),re.compile(rb'github_pat_[A-Za-z0-9_]{20,}'),re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----'),re.compile(rb'\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|C:\\Users\\|/(?:home|Users)/[A-Za-z][\w.-]+|source_thread_id')]
tree=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).split(b'\x00');findings=[]
for name in tree:
 if not name:continue
 path=ROOT/name.decode();blob=path.read_bytes()
 # Scanner's own pattern constants intentionally contain private markers.
 if path.name=='scan-public.py':continue
 if any(p.search(blob) for p in patterns):findings.append(str(path.relative_to(ROOT)))
for commit in subprocess.check_output(['git','rev-list','HEAD'],cwd=ROOT,text=True).splitlines():
 for name in subprocess.check_output(['git','ls-tree','-r','--name-only',commit],cwd=ROOT,text=True).splitlines():
  if name=='scan-public.py':continue
  blob=subprocess.check_output(['git','show',commit+':'+name],cwd=ROOT)
  if any(p.search(blob) for p in patterns):findings.append('history:'+commit[:8]+':'+name)
print('Secret/private-marker scan:',len(findings),'findings',len([n for n in tree if n]),'tracked files');print('\n'.join(findings));sys.exit(bool(findings))
