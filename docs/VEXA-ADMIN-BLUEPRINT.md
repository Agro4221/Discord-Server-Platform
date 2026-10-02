# Vexa Admin & Discord UX Blueprint

## Goal

Vexa is being shaped as a full server-management product, not as a command catalog. The web dashboard is the configuration and operations center; Discord is the fast command surface. Every meaningful feature should have a clear home in the dashboard and, where useful, a direct Discord interaction.

The design is informed by recurring patterns documented by MEE6, JuniperBot and ProBot, while keeping Vexa's own architecture and workflows.

Reference points:
- JuniperBot: configurable server dashboard, command access/cooldowns, custom commands, actions, welcome/ranking/AutoMod/moderation/music and audit features.
- ProBot: module-per-page dashboard; leveling with text/voice XP, excluded roles/channels and role rewards; self-assignable roles with buttons/reactions/selects; AutoMod with detector/action/exception settings; detailed logs.
- MEE6: plugin/module dashboard organization, custom commands, moderation, levels, economy, automations, social alerts, tickets and reaction roles.

Sources:
- https://docs.juniper.bot/guide
- https://docs.juniper.bot/cmd/custom/
- https://docs.juniper.bot/en/cmd/custom/actions/
- https://docs.juniper.bot/auto-moderation/
- https://docs.probot.io/docs/intro
- https://docs.probot.io/docs/modules/automod
- https://docs.probot.io/docs/modules/logs
- https://probot.io/features/leveling-system
- https://probot.io/features/self-assignable-role
- https://help.mee6.xyz/

## Product shape

### Dashboard

Persistent server selector + left module navigation.

- Overview
- Moderation
- AutoMod
- Security / Anti-Raid
- Welcome & Goodbye
- Verification
- Temporary Voice
- Roles / Role Panels
- Tickets
- Leveling
- Giveaways
- Economy
- Starboard
- Reminders
- Automation
- Notifications / Feeds
- Music
- Analytics
- Custom Commands
- Bot Fleet
- Backups
- Audit

A module page is always an actual management page. Do not add a separate feature encyclopedia to the normal admin workflow.

### Discord

Discord is the fast path:

- slash commands for discoverability and structured arguments;
- prefix commands for classic bot usage;
- buttons, select menus and modals for interactive flows;
- ephemeral confirmations for administrative actions;
- embeds/cards for user-facing status views.

### Unified command model

Every built-in command should have metadata:

- command name + aliases;
- module;
- enabled/disabled;
- allowed roles;
- denied roles;
- allowed channels/categories;
- cooldown;
- required Discord permission;
- help visibility;
- prefix/slash availability.

The same access model must be enforced by both prefix and slash paths.

## Feature design

### Moderation

Dashboard:
- searchable member picker;
- warn / timeout / kick / ban / unban;
- duration presets + custom duration;
- reason;
- DM-on-action;
- role hierarchy diagnostics;
- member case history;
- moderation log filters;
- guarded bulk actions.

Discord:
- /warn, /timeout, /kick, /ban, /unban;
- !warn, !timeout, !kick, !ban, !unban;
- duration grammar: 30m / 2h / 7d / permanent;
- history and case IDs.

Future layers:
- softban;
- purge;
- lock/unlock;
- slowmode;
- warn thresholds;
- mod notes;
- case reason templates;
- appeals integration.

### AutoMod

Use a rule model:

Detector -> scope -> exclusions -> response -> punishment -> logging -> cooldown.

Detectors:
- bad words;
- invites;
- links;
- scam/phishing;
- repeated text;
- spam burst;
- caps;
- emoji spam;
- mass mentions;
- line/message length;
- Zalgo;
- honeypot;
- image-only / YouTube-only policies.

Each detector should have target roles/channels, ignored roles/channels/categories, admin/mod bypass, action, timeout, log channel, response template and cooldown.

### Leveling

XP sources:
- messages;
- voice presence;
- optional activity sources later.

Anti-abuse:
- per-user cooldown;
- ignored channels/categories;
- ignored roles;
- AFK exclusion;
- minimum voice population;
- optional daily XP caps.

Progress:
- configurable level curve;
- rank;
- leaderboard;
- progress card;
- text XP / voice XP.

Rewards:
- role at level;
- remove/replace previous reward;
- DM or channel announcement;
- level-up channel/message;
- milestone rewards.

Commands:
- /level, /rank, /top;
- !level, !rank, !top.

### Roles

Role panel builder:
- buttons;
- select menus;
- reaction fallback;
- add/remove/toggle modes;
- max selections;
- exclusive groups;
- custom emoji;
- preview;
- publish/edit/unpublish;
- hierarchy checks.

### Tickets

Dashboard:
- panel builder;
- category;
- staff roles;
- transcript channel;
- claim/unclaim;
- close/reopen;
- reason;
- auto-close;
- per-user limits;
- transcript format.

Discord:
- ticket panel;
- /ticket create;
- button-based management.

### Welcome & Goodbye

Dashboard:
- welcome and goodbye separately;
- channel or DM;
- text/embed;
- variables;
- optional image/card;
- starter roles;
- restore roles for returning users;
- preview.

### Automation

Use a visual builder:

Trigger -> ALL conditions -> ANY conditions -> actions -> cooldown -> audit.

Triggers:
- member join/leave;
- role changes;
- message create/delete/edit;
- reaction;
- voice join/leave/move;
- moderation case;
- ticket events;
- giveaway end;
- schedule.

Actions:
- send message/embed;
- add/remove role;
- timeout;
- warn;
- delete message;
- create channel;
- DM;
- internal command;
- delay;
- conditional branch.

All imported/edited rules must be validated against the actual guild.

### Custom Commands

Custom commands are a builder, not only a text reply.

Command settings:
- name;
- aliases;
- short description;
- prefix/slash availability;
- access rights;
- cooldown;
- role/channel scope;
- enabled state.

Action types:
- send message;
- send embed;
- modal form;
- add/remove role;
- internal command;
- conditional/template action.

Template variables:
- user/server/channel;
- command arguments;
- reusable snippets;
- safe escaping;
- no arbitrary server-side JavaScript.

Examples:
- !rules -> configurable rules embed;
- !level -> built-in level card;
- !color -> role selection/action flow;
- /announce -> guarded staff-only template.

### Music

Dashboard and Discord must control the same player state.

Commands:
- play;
- pause/resume;
- skip;
- stop;
- queue/playlist;
- nowplaying;
- shuffle;
- repeat;
- seek;
- volume;
- autoplay.

Governance:
- same voice channel by default;
- DJ roles / Manage Server override;
- text channel announcements;
- per-voice bot identity routing;
- Lavalink health;
- queue persistence and recovery.

Future player UX:
- persistent Now Playing controller;
- previous/pause/skip/stop buttons;
- queue pagination;
- select-menu controls;
- saved playlists.

### Notifications

Model:

source -> schedule -> destination -> template -> dedupe -> delivery state.

Support:
- RSS/Atom;
- Twitch/YouTube adapters when configured;
- secure URL validation;
- destination channel;
- mention role;
- dedupe cursor;
- retry.

### Analytics

Track:
- member activity;
- messages;
- voice usage;
- moderation;
- level progression;
- tickets;
- music;
- automation;
- notification delivery.

Use time windows and export.

### Audit

Audit should record:
- actor;
- source: dashboard/discord/system;
- module;
- action;
- target;
- reason where applicable;
- metadata;
- timestamp.

Dashboard filters:
- actor;
- action;
- module;
- target;
- time window.

## UX rules

1. Clicking a module opens the actual module immediately.
2. Enable/disable is near the module header.
3. Dangerous actions require confirmation.
4. Every admin action reports success/failure.
5. Settings are grouped by purpose, not shown as a flat database form.
6. Visual features have previews.
7. Prefer Discord selectors/member pickers/channel pickers over raw IDs.
8. Dashboard and Discord enforce the same permissions.
9. Configuration should be safe without understanding internal architecture.
10. The command help page should be generated from the same command metadata used by the runtime.

## Implementation phases

### Phase 1 — foundation
- module-first dashboard;
- unified command metadata;
- command permissions/cooldowns;
- shared prefix + slash routing;
- custom command service;
- audit trail.

### Phase 2 — moderation/community depth
- moderation console;
- AutoMod rule builder;
- leveling exclusions/rewards/cards;
- role panel builder;
- ticket operations.

### Phase 3 — automation/media
- automation action catalog;
- persistent Music controller;
- saved playlists;
- notification sources;
- analytics expansion.

### Phase 4 — polish and reliability
- previews;
- permission diagnostics;
- migration/backfill checks;
- E2E scenarios;
- soak/chaos validation;
- clean-host VPS verification.

## Current repository state

Already introduced in development:
- module-first dashboard shell;
- direct Music slash aliases and prefix commands;
- Level/rank/top commands;
- text + voice XP persistence;
- moderation action service with timed bans;
- prefix moderation parser;
- custom command persistence and dashboard API;
- custom slash registration;
- dashboard Music state/control API;
- dashboard member search and moderation API.

The next layer is to make these capabilities consistent across all modules rather than adding isolated one-off commands.
