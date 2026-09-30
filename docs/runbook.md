# Local runbook

Normal UI: `npm start`, then localhost port 5077. The bound address is loopback, state is synthetic and in memory, and no model runs through a UI action. Stop only this project's process. Do not expose this demo as a multi-user production service.

CPU checks: `npm test` and on Linux `python3 -m unittest discover -s test -p 'test_model_client.py' -v`. These mocks do not reach Ollama. `node plan-evidence.mjs` records actual deterministic calls independently of handwritten gold.

Optional inference requires an explicitly granted shared GPU lease from the coordinating task. Commit the reviewed implementation, run `node evaluate.mjs --prepare`, and commit the resulting immutable input and source snapshots **before** model calls. Inspect current resources and the shared runtime's lock and persistent timeout marker. Use only the existing qwen3:4b weights; no download or paid service is required.

`python3 model_client.py` uses a nonblocking exclusive filesystem lock in the shared private runtime directory. It refuses an existing blocked marker, unsafe/symlink lock or another owner, and preserves each request/response once. Each request has context 4096, output 640, timeout 60s, concurrency 1, no thinking, deterministic options and no truncation/shift request. The provider's actual prompt/output counts and durations are retained rather than inferred from configuration. Successful transport does not imply valid proposal JSON or correct interpretation.

A timeout leaves a durable shared `.blocked` marker before releasing the lock. If it cannot persist that barrier, the process retains its lease. Do not automatically delete a marker, kill another project's inference or retry under uncertainty. Coordinate recovery with the owner, verifying request completion first. Model failures remain evaluation evidence.

After authorized calls, `node evaluate.mjs` preserves raw versus guarded scores, rule-parser and explicit-form comparisons, bound source hashes, completed/incomplete attempts and metrics. It refuses to overwrite existing archives. No UI click makes a live model call. Repeated or stale review is resolved through exact proposal and plan fingerprints.

The UI's confirmation, verifier and receipt serve different purposes. A person confirms interpretation before planning, then separately records inspection of a specific result. UNKNOWN can have a valid incumbent; a local review of that result does not change the solver status or claim optimality. Receipts are in-memory hash-linked local records, not enterprise identity, authorization or certification.
