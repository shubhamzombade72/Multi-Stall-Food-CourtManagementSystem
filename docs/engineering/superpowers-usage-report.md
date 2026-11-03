# Superpowers skills: how they were used (Smart Order Tracking)

Sources: the SDD ledger `.superpowers/sdd/2026-11-03-order-tracking/progress.md`, the per-task briefs and reports in the same folder, the spec `docs/superpowers/specs/2026-11-03-order-tracking-design.md` and the plan `docs/superpowers/plans/2026-11-03-order-tracking.md` (rev. 2).

## Owner rule that changed the standard workflow

The owner explicitly ruled: **no worktree, no branch, no commits**. All work happens in the main working tree and stays uncommitted. This overrides the worktree and commit steps of `using-git-worktrees`, `subagent-driven-development` and `finishing-a-development-branch`.

Without commits there is no per-task BASE/HEAD. Reviewers instead received **file-snapshot diffs**:

- `snap.sh take/diff` created `snap-task1` … `snap-task7` plus `snap-taskNfix1` for the fix rounds;
- the diffs were saved as `task-N-diff.patch` and `task-N-fix1-diff.patch`.

This was the only way to give a reviewer a task-scoped diff while the uncommitted v1.1.0 desktop changes sat in the same files. Risk: a reviewer could miss a file. This was mitigated by implementers listing every file they touched.

## Skills

| Skill | How it was used |
|---|---|
| `brainstorming` | Produced the design (D1–D13) for item-level Cooking → Ready → Served, the compact board and duplicate-safe Serve All. After the first round **the owner opted out of further questions**. The remaining decisions were recorded in the spec as explicit assumptions (rev. 2 notes) instead of being asked. |
| `writing-plans` | Wrote the 7-task plan. **Rev. 2** added four corrections from review: (1) durable idempotency in a `fulfillment_operations` table, (2) the full status read/write inventory, built with grep and Code Review Graph, (3) one transaction with a fixed lock order (order, then tickets, then items) and post-commit events, (4) board bounds (page 100, keyset cursor, `total_active`, no silent hiding). A pre-flight scan over task pairs found one conflict: `PHP_CLI_SERVER_WORKERS` is unsupported on Windows. It was ruled to use 4 separate `php -S` processes against one PostgreSQL DB, with the overlap proven. |
| `subagent-driven-development` | Every task had one implementer subagent and one reviewer subagent; Task 7 was done by one agent with no reviewer, as instructed. Fix rounds and deferred minors went into the ledger:<br>• **Task 1** (schema/settings): implementer (sonnet); review clean; 3 minors deferred.<br>• **Task 2** (FulfillmentService): implementer (opus); review "Needs fixes": the cancel guard was bypassed by item-level progress. Fix round 1 addressed it; 5 minors deferred.<br>• **Task 3** (Serve All + board): review approved with one Important (missing FK/keyset indexes). Fix round 1 added migration `2026_11_03_110000`. Ruling: the board stays unbounded over history (paged and indexed), because the owner requires that no active order is hidden.<br>• **Task 4** (PostgreSQL concurrency): review "Needs fixes": weak overlap proof, and `FulfillmentException` logged at ERROR. Fix round 1 added a per-burst lock-gate overlap proof and `dontReport` with a strict log check.<br>• **Task 5** (pure TS logic): review clean.<br>• **Task 6** (board UI): review "Needs fixes": a stale or out-of-order poll could overwrite a confirmed action. Fix round 1 added mutation/fetch sequencing (`boardMerge.ts`) and a local revert before the forced refresh; 8 minors deferred.<br>• **Task 7**: this agent wrote the E2E, ran the regression and wrote the reports, without dispatching any subagent (instruction). |
| `test-driven-development` | Used in every implementation task, with RED evidence in the task reports:<br>• Task 1: settings/update tests failed first.<br>• Task 2: 16 tests written before the service.<br>• Task 3: 33 tests, 12 failing for the expected reasons.<br>• Task 5: `pnpm test` showed 41 pass / 1 fail (module not found) before the code.<br>• Task 7: both product fixes started with a failing regression test (clock receiver rule; PATCH body parser), then the fix, then green. |
| `systematic-debugging` | Task 7: the new Electron E2E showed a blank board. The steps were:<br>• capture renderer errors (`pageerror`, console);<br>• read the stack ("Illegal invocation" in `subscribe`);<br>• trace it to `createClock` calling `timers.setInterval` as a method, and explain why Node unit tests could not see it;<br>• write a test that reproduces the browser receiver rule, then fix.<br>The second blank page ("reading 'code'") was traced by comparing the controller's response body with the client's parsing. It also explained why the 2/4 check had passed: both optimistic renders landed before the responses. In Task 4 the Windows worker limitation was handled the same way, by root cause rather than by weakening the test. |
| `verification-before-completion` | No result is claimed without a run. Every suite was re-run after the fixes, with the exact command, exit code and counts recorded in `docs/engineering/order-tracking-test-results.md`. The embedded server copy was refreshed (`pnpm prepare:server`) and the renderer rebuilt before the Electron runs, so the E2E tested the real current code. |
| `using-git-worktrees`, `finishing-a-development-branch` | **Not used**, by owner rule (see above). Integration (commit or PR) is left to the owner. |

## Process facts

- Fix rounds: 4 of 6 implementation tasks needed exactly one fix round; none needed a second. All reviews were clean after round 1.
- Deferred minors are kept in the ledger for follow-up. Examples: Load-more pages are never refreshed; a forced error refresh can briefly overwrite a concurrent success (self-heals within one poll); a hard-killed concurrency runner can leave `php` processes behind.
- Final state: 147/147 backend tests on PostgreSQL and on SQLite, 61/61 desktop unit tests, all E2E suites green (see the results document). Nothing is committed.
