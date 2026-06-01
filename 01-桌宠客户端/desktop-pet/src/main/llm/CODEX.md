# Codex Notes: LLM Tool Loop

This directory owns the agentic tool runtime. Treat `llm-client.ts`,
`tool-defs.ts`, and `tools.ts` as one maintenance unit.

## Boundaries

- `llm-client.ts` owns provider streaming, fallback classification, and the AI
  SDK multi-step tool loop.
- `tool-defs.ts` owns AI SDK `ToolSet` schemas and `toModelOutput`.
- `tools.ts` owns real side effects, path safety, approvals, audit logging, and
  runtime validation.
- Do not call side-effect tools directly from `llm-client.ts`; route through
  `executeTool` so safety and audit behavior stays centralized.

## Tool Loop Rules

- `MAX_TOOL_STEPS` is the safety brake for continuous tool use. If it changes,
  update the `tool-loop-limit` user-facing error path in `shared/chat-types.ts`,
  renderer `chatErrorText`, and i18n strings.
- A stream that reaches the step cap with `finishReason === 'tool-calls'` must
  surface `tool-loop-limit`; otherwise the user sees completed tool cards with no
  explanation.
- Tool events shown in the renderer come from `fullStream` parts. Preserve
  `toolCallId` matching; duplicate `start` events must not create extra running
  cards.

## Output Adapters

- `view_screen` returns image content. For AI SDK v6, image tool output must use
  `{ type: 'image-data', data, mediaType }`. Do not change it back to
  `file-data`; non-PDF `file-data` can be silently dropped by provider adapters.
- Tool `ok:false` becomes a thrown error in `wrapTool`; the SDK turns it into a
  model-visible tool error so the assistant can continue naturally.

## Runtime Validation

- Keep runtime validation in `tools.ts` even when Zod schemas exist in
  `tool-defs.ts`. Model-generated input and future callers can drift.
- `write_docx` intentionally rejects empty title/section/paragraph content at
  runtime. Do not weaken this guard to allow placeholder empty documents.
- Provider native tools are gated by `selectedModel`, not only provider name.
  Some models reject native tools they do not support.
