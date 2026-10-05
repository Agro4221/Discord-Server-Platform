# Native Windows Resource Requirements

This is an engineering budget for the current `feature/music-v2` runtime, not a benchmark result from a particular PC. Actual RSS/CPU usage should be measured on the target machine with `native-status.bat` during idle, normal music playback and stress tests.

## Default gaming mode

`start.bat` starts the native bot stack with PostgreSQL as a separately installed Windows service/process, one Lavalink node, and the compiled Discord bot. Dashboard is OFF.

The current launcher defaults to `-Xms128m -Xmx512m` for the Lavalink JVM and caps the bot Node.js old-space heap at 768 MiB. Node.js documents `--max-old-space-size` as the V8 old-generation memory limit, so this is an intentional safety ceiling rather than a promise of actual RSS usage. citeturn516863search0

Estimated application footprint:
- Lavalink: roughly 0.3–0.8 GiB RSS under ordinary playback, including the configured Java heap plus JVM/native overhead.
- Bot: roughly 0.15–0.6 GiB RSS depending on guild count, Discord events, caches and workload.
- PostgreSQL: roughly 0.1–0.4 GiB for a small self-hosted installation; memory is workload/configuration dependent.
- Total native DSP stack target: about 0.7–1.8 GiB RSS in normal operation, with about 2 GiB reserved as a practical safety budget.

Lavalink is intended as a relatively small-footprint standalone audio node, and Lavalink 4 requires Java 17+. citeturn374577search9turn374577search2

## Full local mode

`control-center.bat` adds the Next.js Control Center.

Expected additional Dashboard RSS: roughly 0.15–0.4 GiB during normal use.

Practical whole-stack budget:
- normal: ~1.0–2.0 GiB
- reserve: ~2.5 GiB

## Redundancy mode

`start.bat -Lavalink2` runs a second Lavalink node.

With the current default heap settings, the second node adds up to another 512 MiB of configured Java heap plus JVM/native overhead.

Practical whole-stack budget:
- one Lavalink, no Dashboard: ~0.7–1.8 GiB
- one Lavalink + Dashboard: ~1.0–2.0 GiB
- two Lavalinks + Dashboard: ~1.5–2.8 GiB
- reserve for bursts and garbage collection: ~3.5 GiB

## PC tiers

| Tier | System RAM | CPU | Free SSD | Intended use |
|---|---:|---:|---:|---|
| Minimum | 4 GiB | 4 logical threads | 8 GiB | Bot + one Lavalink, light server, Dashboard rarely used |
| Recommended | 8 GiB | 4–6 logical threads | 15 GiB | Bot + Lavalink + normal Dashboard use |
| Comfortable | 16 GiB | 6–8 logical threads | 20+ GiB | Multiple guilds, regular music, Dashboard, OBS/browser |
| Heavy | 32 GiB | 8–12 logical threads | 30+ GiB | Two Lavalinks, many guilds/voice sessions, OBS + modern game + browser |

These RAM tiers describe the whole Windows PC, not RAM reserved exclusively for the bot. For a gaming/streaming PC, 16 GiB is the practical lower target when a modern game + OBS + browser + DSP run together; 32 GiB gives substantially more headroom.

## CPU expectations

The platform is predominantly event-driven. Idle CPU should normally be very low; music playback and bursts of Discord/API activity are the main causes of short spikes. The numbers above are capacity tiers, not hard CPU limits.

Do not run the second Lavalink node in everyday gaming mode unless redundancy is actually needed. The native launcher keeps it OFF by default.

## Disk and logs

The native launcher stores runtime logs under `.native-runtime/logs`. Each stdout/stderr log is rotated when it exceeds 10 MiB, keeping one previous file.

The largest disk consumer during setup is expected to be the Node.js dependency tree and build artifacts, not the running bot itself.

## Measuring the real machine

Run `native-status.bat`.

It reports the machine RAM/logical CPU count and the current working set of the native DSP processes tracked by the launcher.

For final acceptance, record `native-status.bat` at idle, during one active music session, during several simultaneous guild/music sessions, with Dashboard open, and with the chosen game + OBS running together. Use the measured RSS rather than the estimate above as the final local hardware recommendation.
