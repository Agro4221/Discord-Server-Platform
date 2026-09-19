# Test Strategy

## Unit
- configuration validation
- permission evaluation
- automation conditions/actions
- temporary voice state machine
- queue operations
- infraction escalation
- provider selection/resolution

## Integration
- PostgreSQL migrations/persistence
- bot startup/shutdown
- dashboard API + database
- command registration with a test application/guild
- temporary voice lifecycle against a test guild
- Lavalink connection and basic playback

## Failure injection
- kill/restart bot
- drop database connection
- drop Lavalink
- force Discord Gateway disconnect
- remove managed channel/role manually
- remove required permissions
- provider timeout/invalid response

## Acceptance
A module is complete only when main path, configuration, permission failures, persistence, restart behavior and recoverable external failures are covered by tests or an explicit documented limitation.

Real credentials are always environment-injected and never stored in fixtures or git.
