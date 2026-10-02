# Quality Bar

The project is held to a production-grade standard from the first implementation.

## No feature is accepted on a happy-path demo

For each feature we require, where applicable:
- normal flow
- invalid input
- missing permission
- wrong role hierarchy
- duplicate/replayed request
- concurrent request
- restart/reconnect during operation
- dependency outage
- stale external state
- audit/log verification
- persistence verification
- security-boundary verification

## Bug protocol

Every reproducible defect must become:
1. a regression test or an explicit documented reason why that is impossible;
2. a fix;
3. a verification run showing the original failure no longer occurs;
4. a check that related behavior was not broken.

## Cross-module rule

When a feature changes a shared component, its affected dependents must be exercised before the change is considered safe.

## Destructive operations

Ban/kick, role/channel deletion, anti-nuke responses, cleanup and automation actions require explicit permission evaluation and protection against accidental amplification.

## Reliability

A service restart is normal operation, not an exceptional event. Durable state must survive it.

## Observability

Every serious failure must leave enough local diagnostic information to answer:
- what failed
- where it failed
- which guild/module/workflow was involved
- whether state was committed
- whether recovery was attempted
- what the operator should do next

Secrets and sensitive credentials must never be present in those diagnostics.

## Release gate

No release candidate is produced until:
- exhaustive functional checks pass;
- security checks pass;
- failure/recovery checks pass;
- cross-module regression passes;
- backup/restore is demonstrated;
- known limitations are documented;
- installation from clean instructions succeeds.
