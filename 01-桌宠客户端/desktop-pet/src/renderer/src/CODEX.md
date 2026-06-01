# Codex Notes: Renderer Runtime

This directory is the live pet UI and chat surface. Most bugs here are IPC race
or state-layer bugs, not visual styling bugs.

## IPC State Rules

- Subscribe first, then request current state. Pattern: `onX(...)` followed by
  `requestXState()`. This prevents main-process `did-finish-load` pushes from
  racing React effect setup.
- `chat:tool-event` cards are keyed by `toolCallId`. A second `start` with the
  same id must be ignored; `end` and `error` only update the matching card.
- Before a new submit or chat error, sweep still-running tool cards to `error`.
  Aborted streams do not always produce a final `tool-result`.

## Pet Rendering Rules

- Do not reintroduce the removed eye overlay / layered wizard eye-following
  path. Furina idle uses the inline idle SVG plus container tilt/shadow only.
- `STATE_GIF` is the renderer-side map for canonical states and legacy aliases.
  Add new state sprites there instead of growing a new `if/else` chain.
- Full mode and mini mode are separate render paths. Mini mode should not depend
  on full-mode idle cursor follow.

## Maintenance Checks

- After changing chat/tool/UI IPC behavior, run `npx eslint . --quiet` and
  `npm run typecheck`.
- After changing pet rendering or state subscriptions, fresh-start `npm run dev`
  and confirm main, preload, renderer, and Electron startup logs appear.
