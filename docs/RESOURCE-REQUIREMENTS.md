# Native Windows Resource Requirements

These figures describe **only Discord Server Platform itself**: PostgreSQL + one Lavalink + bot + local Control Center. They exclude games, OBS, browsers, Discord client and every other user workload.

## Estimated runtime footprint

| Component | Typical RAM | Configured ceiling |
|---|---:|---:|
| Discord bot | ~150–400 MiB | 768 MiB Node old-space |
| Control Center | ~120–350 MiB | 512 MiB Node old-space |
| Lavalink | ~300–700 MiB RSS | 512 MiB Java heap (`Xmx`) + JVM/native overhead |
| PostgreSQL | ~100–300 MiB for a small local DB | workload/configuration dependent |
| **Whole stack** | **~0.7–1.7 GiB typical** | **~2–2.5 GiB practical reserve** |

These are engineering estimates, not measured benchmarks. RSS can temporarily exceed configured heap sizes because runtimes also use native memory, buffers, class metadata and other process overhead.

## Hardware tiers

| Tier | RAM | CPU | Free SSD | What it means for DSP |
|---|---:|---:|---:|---|
| Minimum | 4 GB | 2 cores / 4 threads | 10 GB | One bot + one Lavalink + PostgreSQL + occasional Control Center; small server/workload |
| Recommended | 8 GB | 4 cores / 8 threads | 15 GB | Normal everyday use with Control Center and regular Music |
| Comfortable | 16 GB | 6 cores / 12 threads | 20 GB | Several guilds, sustained Music/background activity and optional second Lavalink |
| Maximum practical | 32 GB | 8 cores / 16 threads | 30 GB | Large self-hosted deployment / multiple bot identities and heavy concurrent Music; more hardware is generally unnecessary for the platform itself |

**Important:** the 16/32 GB tiers are not saying the bot needs that much memory. They are headroom tiers for unusually large self-hosted deployments. For a normal single-user PC running only this platform, **8 GB is the target recommendation**; 4 GB is the lower practical floor.

## CPU behavior

The platform is mostly event-driven. Idle CPU should normally be low. Short spikes come from startup/builds, Discord event bursts, database migrations, Dashboard requests and Music operations.

One-time first launch is heavier because the launcher can install missing runtimes, install npm dependencies, build the project and download Lavalink. Normal subsequent launches reuse those artifacts.

## Disk

The runtime itself is small. The first install needs space for Node dependencies, Next.js build output, PostgreSQL data, the Lavalink JAR and logs. 10 GB is a practical minimum; 15 GB is the recommended free-space target.

## Measuring your actual machine

The single launcher supports `start.bat -Status`, which reports the working set of native DSP processes tracked by the launcher.

For a final machine-specific number, compare the tracked working set after 10–15 minutes of idle, during an active Music session, with the Control Center open, and during the largest Discord workload you actually expect. The numbers above should then be replaced by those measured values if they differ materially.
