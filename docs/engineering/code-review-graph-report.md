# Code Review Graph: usage and findings (Smart Order Tracking)

Tool: `code-review-graph` (Tree-sitter graph of calls, imports and tests). It was used through the MCP tools during planning and through the CLI in Task 7. Repository: `D:/New folder/Multi-Stall-Food-CourtManagementSystem`, branch `main`, graph built at commit `329894189158`.

## 1. Planning phase (spec rev. 2 / plan rev. 2, correction 2 "status read/write inventory")

| Step | Command / tool | Result used |
|---|---|---|
| Minimal context for the status columns | MCP `get_minimal_context` | Entry points for `stall_ticket_items.status`, `order_items.status`, `stall_kitchen_tickets.status` and `orders.status`. These were cross-checked with `grep` over `backend/app`, `backend/database`, `backend/routes`, `backend/tests` and `frontend-*`. The result is the writer/reader table in the plan (it also found the `cancelOrder` bug: item rows were not cancelled). |
| Test coverage of the writers | MCP `query_graph` pattern `tests_for` on the controller methods | **0 results for controllers.** Laravel feature tests call URLs (`$this->postJson('/api/...')`), so there is no static call edge from the test to the controller. Coverage was taken from the test files instead: `EndToEndFoodCourtWorkflowTest`, `StagingHardeningTest`, `KitchenKdsTest`, `OrderSplittingTest`, `MasterModulesTest`. |
| Blast radius | MCP `get_impact_radius` on the 6 changed tracked backend files (the status writers in the inventory: Kitchen/Order/Waiter/Settings controllers and the Order / StallTicketItem models) | **39 nodes changed, 26 impacted nodes, 22 files.** This set the regression scope: KDS, waiter station, POS/orders, billing readers, customer QR view and reports were all kept in the full-suite runs. |

## 2. Task 7 (final review), commands run now

```
code-review-graph update
  INFO: Excluding 1 nested build-output directory ... RMS/apps/web/.next
  INFO: Scoped resolver: resolved 0 CALLS edges across 116 files
  Incremental: 0 files updated, 0 nodes, 0 edges (postprocess=full)        exit 0

code-review-graph detect-changes --brief
  Analyzed 55 changed file(s):
    - 105 changed function(s)/class(es)
    - 33 affected flow(s)
    - 70 test gap(s)
    - Overall risk score: 0.85
    - Untested: AuthController, login, BillingController, getPendingBills, CustomerController
  Token savings: full context 302,237 tokens vs graph context 38,156 (~87% saved)   exit 0

code-review-graph status
  Nodes: 1048  Edges: 12966  Files: 200
  Languages: blade, javascript, php, powershell, tsx, typescript
  Last updated: 2026-11-03T19:30:09  Built on branch: main  Built at commit: 329894189158

code-review-graph query tests_for updateTicketStatus   -> results: []  ("php container-resolved and constructor-injected calls are not statically traced")
code-review-graph query tests_for markTicketServed     -> results: []  (same note)
code-review-graph query tests_for createOrder          -> BillingPaymentTest, EndToEndFoodCourtWorkflowTest, OrderSplittingTest (name-based matches)
code-review-graph query callers_of updateTicketStatus  -> 1 direct: backend/routes/api.php
code-review-graph query file_summary backend/app/Services/FulfillmentService.php -> "target not indexed"
code-review-graph query file_summary frontend-desktop/src/lib/clock.ts            -> "target not indexed"
```

## 3. Findings

1. **The change surface is wide, and it matches what the plan expected.** The 55 changed files include the uncommitted v1.1.0 desktop work that shares the working tree, not only order tracking. The 33 affected flows are the KDS, waiter, POS/order and billing flows that the inventory listed. Every one of them is covered by the full PostgreSQL + SQLite backend runs (147/147 each) and by the business-workflow, lifecycle and multi-PC E2E suites. See `order-tracking-test-results.md`.
2. **The "70 test gaps / Untested: AuthController, BillingController, ..." figures are partly false positives.** These controllers are exercised by feature tests over HTTP, and the graph cannot link URL calls to controllers. They are not evidence of missing tests. The real coverage is in `backend/tests/Feature/*`.
3. **The graph does not see the core of this feature.** `FulfillmentService`, `FulfillmentController`, `lib/clock.ts`, `lib/fulfillment.ts`, `lib/boardMerge.ts`, `api/fulfillment.ts` and the new tests are untracked files. The graph indexes from `git ls-files`, so it reports them as "not indexed". Its risk score therefore *under*-states the change. The new code was reviewed by the per-task reviewers and covered by tests instead (ItemFulfillmentTest, the concurrency E2E, the unit tests and the new Electron E2E).
4. **The incremental update found 0 files to re-index.** This is consistent with point 3: the modified tracked files were already indexed at the last build, and the new files are invisible until they are added to git.
5. **The graph did not catch the two defects found in Task 7**, and could not have:
   - the browser-only `setInterval` receiver error in `clock.ts`;
   - the response-shape mismatch between `FulfillmentController::updateItemStatus` and `api/fulfillment.ts`, which crosses PHP to TypeScript over HTTP and lives in untracked files.

   Both were found by running the real Electron renderer.

## 4. Limitations (recorded honestly)

- Laravel feature tests reach controllers through URLs, so `tests_for` misses controllers.
- PHP container-resolved / constructor-injected calls are not traced. An example is `FulfillmentService` injected into the controllers.
- Brand-new untracked files are not indexed, because the graph uses `git ls-files`. Because of the owner's no-commit rule, all new files of this feature were outside the graph during implementation.
- There are no PHP-to-TypeScript (HTTP contract) edges, so API shape mismatches between backend and renderer are out of scope for the graph.
- `RMS/apps/web/.next` is excluded automatically as build output.

Recommendation: after the owner commits, or at least runs `git add`, rerun `code-review-graph update` and `detect-changes`. Only then do the graph's risk and test-gap numbers cover the fulfilment service.
