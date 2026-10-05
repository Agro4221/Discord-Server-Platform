# Implementation & Completion Strategy

## Product north star
The platform is a self-hosted replacement for the usual stack of third-party Discord bots and their premium subscriptions. We combine the most useful capabilities seen across Carl-bot, Juniper, MEE6, ProBot, Jockie Music and similar products into one integrated system.
The implementation is our own. We borrow product ideas and UX patterns, not proprietary code.

## Completion rule
A capability is considered complete only when it is wired through the appropriate layers:

- Domain/Core behaviour;
- persistence where state must survive restart;
- permission and hierarchy checks;
- Management API where administration is required;
- Control Center where an administrative UI is appropriate;
- audit/recovery where applicable;
- regression coverage.
Discord commands remain fast/user-facing entry points. Control Center is the primary local administration surface.

## Current release phase
The repository is in **release-candidate mode**. Functional expansion is not allowed to grow without a concrete reason.

Current release-gate work is environment-dependent:

- live Discord E2E;
- real Lavalink restart/resume and multi-node failover;
- real multi-bot takeover;
- native Windows runtime acceptance;
- clean-host VPS install/upgrade;
- controlled chaos/soak/security runs.

## Post-RC functional depth
Only explicit, useful gaps should become new feature slices. The currently known breadth/depth areas are:

1. deeper AutoMod/Security response policies;
2. broader Automation conditions/actions;
3. wider Music providers and full multi-node failover;
4. deeper Fleet orchestration/failover;
5. production VPS workflow hardening.

## Work method
Use small independent slices:

1. inspect the existing contract;
2. implement one coherent change;
3. add focused regression tests;
4. run/verify CI;
5. update continuity documentation;
6. continue only after the slice is green.

Avoid mass rewrites and speculative abstraction. Preserve working functionality while removing redundant work, stale code and contradictory documentation.