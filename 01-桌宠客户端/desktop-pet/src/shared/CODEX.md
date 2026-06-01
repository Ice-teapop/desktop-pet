# Codex Notes: Shared Contracts

Files here are cross-process contracts. A small type edit can require matching
changes in main, preload, renderer, and i18n.

## Chat And Tool Contracts

- `chat-types.ts` is the source for `ChatError`, `ToolEvent`, usage, and chat
  history reset events.
- Any new `ChatError.kind` needs matching renderer handling in `chatErrorText`,
  zh/en i18n strings, and main fallback or history rollback policy if relevant.
- `ToolEvent.toolCallId` is the stable id for renderer tool cards. Keep it
  opaque; do not derive behavior from its format.

## Pet State Contracts

- `pet-state.ts` contains canonical state names plus legacy aliases used by the
  state machine and renderer mapping.
- `thinking` is set by chat flow and should not be exposed as a public
  `set_pet_animation` option.
- If aliases are removed, grep theme JSON, renderer `STATE_GIF`, and tool schema
  descriptions in the same change.

## Display Contracts

- `tool-display.ts` is UI labeling only. It should not contain tool execution
  logic.
- i18n keys under `tool_label.*`, `err.*`, and `chat.*` must stay complete in
  both zh and en files; the renderer does not have a second fallback layer for
  missing keys.
