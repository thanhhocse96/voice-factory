# AGENTS.md - ZeroClaw Vbee Automate

> Read this file before changing code. This project uses `../context-mapping` as the agent control and memory layer.

## Current Milestone

Current milestone: **M2 - Browser CDP Health And Vbee Preview Harness**

Milestone source of truth: `.context/MILESTONES.md`.

Detailed milestone backlog: `.context/MILESTONE_ROADMAP.md`.

## Startup Protocol

Every agent task starts with:

```text
1. Read .context/GLOBAL.md
2. Read .context/MILESTONES.md
3. Read .context/MILESTONE_ROADMAP.md only for the current or next milestone being promoted
4. Read .context/TENSIONS_OPEN.md
5. Read .context/TENSIONS_ACTIVE.md
6. Load the module context relevant to the files being edited
```

For Gateway work, load:

```bash
python3 ../context-mapping/cli.py load gateway/src . --include-manual
```

If `.local/ENVIRONMENT.md` exists, read it before running local toolchains, starting servers, installing dependencies, or using paths specific to this machine.

## Milestone Source Protocol

Agents must not invent broad roadmap scope from memory. Build milestone scope from source documents in this order:

```text
1. Latest explicit human instruction
2. .context/MILESTONES.md current milestone
3. .context/MILESTONE_ROADMAP.md promoted milestone
4. .context/modules/*.md manual sections
5. docs/design/*.md architecture decisions
6. docs/milestones/*.md implemented evidence
7. code reality
```

Use `.context/MILESTONES.md` as the active checklist and `.context/MILESTONE_ROADMAP.md` as the backlog. Do not load or implement multiple future milestones at once.

When promoting the next milestone:

```text
1. Read the roadmap entry.
2. Read every source doc listed in that entry.
3. Compare source docs against current code and implemented milestone docs.
4. Copy only that milestone's goal, acceptance, out-of-scope, and source docs into .context/MILESTONES.md.
5. Update AGENTS.md current milestone line.
6. Ask the human if acceptance is vague, risky, or conflicts with sources.
```

Ask before coding when:

- Source docs conflict about behavior or priority.
- Acceptance cannot be verified with a concrete test.
- A live credential, paid provider account, browser install, or system package is required.
- A DB migration, destructive file operation, or data cleanup touches user data.
- A decision would expand scope beyond the promoted milestone.

## Agent Control Rules

- `.context/` is the active agent memory and constraint layer.
- `docs/` is the human architecture memory.
- The human owns intent. The agent implements and verifies.
- `[manual]` sections in `.context/**` must not be overwritten.
- If code changes invalidate a manual invariant, write a tension before continuing.
- If a tension is `high`, stop and wait for human decision.
- Do not install Node, Python packages, browsers, or system tools without an installation plan and approval.

## Documentation Protocol

Agents must keep implemented work documented in `docs/`.

Documentation has two layers:

```text
docs/design/
  01_<name>.md
  02_<name>.md

docs/milestones/
  <milestone>_<sequence>_<name>.md
```

Rules:

- Design source documents belong in `docs/design/` and use numeric order: `01_`, `02_`, `03_`.
- Implemented milestone work belongs in `docs/milestones/`.
- Milestone file names must match the milestone code from `.context/MILESTONES.md`, for example `M0_001_gateway-core-fake-end-to-end.md`.
- Every meaningful completed slice must have or update a milestone doc.
- Milestone docs must prioritize workflow diagrams first, preferably Mermaid.
- Milestone docs must explain what was implemented, which files changed, which design pattern was used, how to verify it, and known limits.
- After adding a docs file, update `docs/README.md`.
- If the current milestone changes, update `.context/MILESTONES.md`, `AGENTS.md`, and docs naming together.

## Module Test And Report Protocol

After finishing a module or meaningful slice, agents must:

1. Run the module-specific test or smoke command.
2. Run the relevant syntax/static checks.
3. Run context consistency check.
4. Create or update a test report under `docs/milestones/` using the current milestone code.
5. Include command, result, covered cases, residual risk, and next action.

Test report filename format:

```text
<milestone>_<sequence>_<module>-test-report.md
```

If a test cannot be run, the report must say why and what remains unverified.

## Architecture Rules

- Gateway Core is the only process allowed to write SQLite.
- UI, ZeroClaw, and future clients talk to Gateway API only.
- JobRunner must not import browser automation, raw filesystem writes, or raw SQLite directly.
- Browser, Vbee, DB, and File IO must sit behind services/adapters.
- Vbee real integration is not part of M0. Use fake adapter first.
- Podman is optional and must not be the default runtime for MVP.

## Local Runtime

Use WSL Debian as the primary technical environment:

```bash
cd /mnt/d/Github/ZeroClaw-Vbee-Automate
```

Node is required for Gateway execution. If it is missing, follow the installation protocol instead of improvising.

### Manual Test Request Protocol

When the human asks to "bật lên", "online", or "test thử" for manual browser testing, do not spawn a hidden/background Windows process.

Return this WSL foreground instruction instead:

```bash
cd /mnt/d/Github/ZeroClaw-Vbee-Automate
source ~/.nvm/nvm.sh
nvm use 24
HOST=0.0.0.0 npm run dev
```

Tell the human to keep that WSL terminal open, then open:

```text
http://127.0.0.1:3000/
```

If Windows browser cannot connect through `127.0.0.1`, ask the human to run this in WSL:

```bash
hostname -I
```

Then use:

```text
http://<WSL_IP>:3000/
```

## Verification

For context:

```bash
python3 ../context-mapping/cli.py check-consistency .
python3 ../context-mapping/cli.py build . --quiet
```

For Gateway after Node is available:

```bash
npm run dev
curl http://127.0.0.1:3000/health
```
