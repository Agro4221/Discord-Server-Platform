# Test & Verification Strategy

This project is treated as a reliability-critical system. Testing is not a final checkbox.

## Verification layers

### 1. Static verification
- TypeScript strict type checking
- linting
- formatting
- dependency audit
- secret scanning
- forbidden-file/path checks
- schema validation
- migration consistency
- dead-code and unreachable-code checks where tooling supports them

### 2. Unit verification
Every deterministic domain rule must have tests:
- configuration validation
- permissions
- role hierarchy rules
- module enable/disable behavior
- event routing
- automation conditions/actions
- temporary voice state transitions
- infraction escalation
- queue operations
- provider selection
- recovery/reconciliation logic
- serialization/deserialization
- import/export validation

### 3. Integration verification
Verify real component boundaries:
- PostgreSQL
- bot process
- dashboard
- Discord application/guild
- Lavalink
- worker jobs
- filesystem/persistent volumes
- protected Management API bearer flow
- provider adapters

### 4. End-to-end verification
Test user-visible workflows across modules, including:
- member join -> verification -> roles -> welcome
- temporary voice -> ownership -> permissions -> cleanup -> restart recovery
- moderation -> case -> escalation -> log
- ticket -> claim -> staff action -> transcript -> archive
- music -> search -> resolve -> Lavalink -> player -> queue -> recovery
- automation -> event -> condition -> action -> audit
- dashboard -> setting change -> Discord behavior -> audit entry
- export -> import -> reconciliation

## Adversarial testing

We intentionally try to break the system.

### Process failures
- kill bot at arbitrary points
- restart bot repeatedly
- crash workers
- restart dashboard
- interrupt migrations
- fill logs
- corrupt disposable local state
- restart services in unexpected order

### Network failures
- disconnect Discord Gateway
- add latency
- drop packets in test environments
- DNS/provider failures where reproducible
- HTTP timeouts
- malformed provider responses
- rate-limit responses
- partial responses

### Dependency failures
- PostgreSQL unavailable
- Lavalink unavailable
- provider unavailable
- OAuth unavailable
- filesystem read/write failure

### Discord-state drift
- delete channels managed by the bot
- delete roles managed by the bot
- rename managed resources manually
- move categories
- change permissions
- reorder bot role below a managed role
- remove permissions while a workflow is active
- manually close/archive/delete ticket channels
- move users between voice channels unexpectedly

### Input abuse
- empty input
- oversized input
- Unicode edge cases
- invalid IDs
- malformed URLs
- duplicate submissions
- repeated clicks
- stale interaction payloads
- forged/unauthorized dashboard requests
- command spam

### Concurrency/race conditions
- two owners edit one temporary room simultaneously
- two staff claim one ticket
- multiple users trigger the same automation simultaneously
- concurrent queue modifications
- simultaneous module enable/disable
- restart during a write
- restart during a Discord mutation

### Security abuse
- privilege escalation through role hierarchy
- Management API bearer-key leakage/replay attempts
- replay of stale dashboard actions
- unauthorized guild access
- cross-guild data leakage
- cross-guild data leakage
- secret leakage in logs/errors
- automation chains that amplify into spam or destructive actions
- unsafe webhook destinations
- path traversal against local file features

## Fault injection / chaos

The test environment should support controlled fault injection so we can prove recovery rather than merely assume it.

Examples:
- kill -9 equivalent for services
- DB connection interruption
- Lavalink restart during active playback
- Gateway reconnect during temporary-channel creation
- process termination between database write and Discord API write
- Discord resource deletion between read and write
- delayed provider response after user timeout

## Performance / soak
Measure and monitor:
- startup time
- command latency
- dashboard latency
- DB query latency
- memory growth
- CPU under load
- concurrent guild activity
- simultaneous music sessions
- queue growth
- log volume
- reconnect storms

Run long-lived soak tests where practical to detect leaks and state drift.

## Data integrity
- transaction boundaries
- idempotency of repeated operations
- migration rollback/forward checks where supported
- import/export round trips
- backup/restore verification
- orphan detection
- stale-state cleanup
- cross-guild isolation

## Acceptance rule

A feature is NOT complete because the happy path works.

A feature is complete only when:
1. normal operation works;
2. configuration works;
3. permissions are handled correctly;
4. invalid input is safe;
5. repeated operations are safe/idempotent where intended;
6. persistence is correct;
7. restart/reconnect recovery is correct;
8. external failures degrade safely;
9. concurrent use is safe;
10. audit/log behavior is correct;
11. security boundaries hold;
12. the behavior is documented.

## Evidence

For every major subsystem we keep:
- test cases
- reproducible bug reports
- failure-injection results
- performance observations
- known limitations
- regression coverage for fixed defects

The standard is not “seems stable”. The standard is reproducible evidence.
