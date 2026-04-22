# Hermes Runtime

Last updated: 2026-04-22

This is the current high-signal map for the Python runtime/orchestration code that lives in this workspace.

External agents such as Hermes are the intended audience for this document. Use it to understand the in-repo runtime code; do not assume this repo is only a Hermes checkout.

## Runtime Flow

1. `hermes_cli.main:main` bootstraps environment, logging, and profile selection.
2. `cli.py` builds the interactive TUI or dispatches subcommands.
3. `run_agent.py` owns the actual agent loop through `AIAgent`.
4. `model_tools.py` discovers tool modules and exposes schemas plus dispatch.
5. `tools/*.py` self-register via `tools/registry.py`.
6. `hermes_state.py` persists sessions/messages in SQLite with FTS5.
7. `gateway/run.py` reuses the same runtime for messaging platforms.

## Core Files

| File | Main Responsibilities | Public Surface To Know |
| --- | --- | --- |
| `run_agent.py` | Conversation loop, tool-call loop, budget enforcement, model/provider execution wiring, cleanup | `AIAgent`, `IterationBudget`, `main()` |
| `model_tools.py` | Tool discovery, sync/async bridging, schema filtering by toolset, argument coercion, handler dispatch | `get_tool_definitions()`, `handle_function_call()`, `check_toolset_requirements()` |
| `toolsets.py` | Named tool group definitions and resolution | `resolve_toolset()`, `get_all_toolsets()`, `validate_toolset()` |
| `cli.py` | Interactive chat UX, config loading, worktree helpers, command handling | `load_cli_config()`, `HermesCLI`, `main()` |
| `hermes_state.py` | Persistent sessions/messages with WAL and FTS5 | `SessionDB` |
| `gateway/run.py` | Messaging gateway lifecycle, config-to-env bridging, platform startup | `GatewayRunner`, `start_gateway()` in module flow |
| `tools/registry.py` | Registry singleton, self-registering tool discovery, availability snapshots | `registry`, `discover_builtin_tools()` |

## `run_agent.py`

`run_agent.py` is still the single most important Hermes file.

Important parts:

- `_SafeWriter`: prevents stdout/stderr failures from crashing long-running/headless sessions.
- `IterationBudget`: shared budget primitive used by parent/subagent turns.
- `AIAgent`: owns model selection, prompt assembly, tool orchestration, compression, retries, and final response production.
- `main()`: CLI-facing entrypoint for direct agent execution.

When debugging execution behavior, start in `AIAgent.run_conversation()` and follow outward to:

- `agent/prompt_builder.py`
- `model_tools.py`
- `agent/context_compressor.py`
- `agent/auxiliary_client.py`
- `agent/error_classifier.py`

## `agent/` Package

High-signal modules:

- `agent/prompt_builder.py`: assembles system prompt, environment hints, skills prompt, and context-file prompt blocks.
- `agent/context_compressor.py`: automatic compression logic when turns approach context limits.
- `agent/prompt_caching.py`: Anthropic cache-control support.
- `agent/auxiliary_client.py`: secondary LLM client resolution for vision, extraction, approval, and helper tasks.
- `agent/model_metadata.py`: context-length inference, token estimation, local endpoint detection.
- `agent/models_dev.py`: models.dev metadata lookup and provider/model capabilities.
- `agent/display.py`: spinner, tool-preview rendering, inline diff rendering.
- `agent/skill_commands.py`: slash-command scanning and skill message injection.
- `agent/trajectory.py`: trajectory save helpers for research/batch workflows.
- `agent/context_references.py`: expands file/folder/git references embedded in prompts.
- `agent/anthropic_adapter.py` and `agent/bedrock_adapter.py`: provider-specific request/response translation layers.

## `hermes_cli/`

This package contains the real CLI command surface beyond the TUI shell in `cli.py`.

High-signal modules:

- `hermes_cli/main.py`: top-level parser and profile bootstrap.
- `hermes_cli/config.py`: default config, migration, env/config loading, validation.
- `hermes_cli/commands.py`: canonical slash-command registry.
- `hermes_cli/model_switch.py`: provider/model switching logic.
- `hermes_cli/auth.py`: provider credential resolution, OAuth and token management.
- `hermes_cli/setup.py`: setup wizard.
- `hermes_cli/skills_hub.py`: `/skills` browsing/install flows.
- `hermes_cli/tools_config.py` and `hermes_cli/skills_config.py`: enabled/disabled tool and skill management.
- `hermes_cli/skin_engine.py`: data-driven CLI theming.
- `hermes_cli/doctor.py`: environment diagnostics.

## `tools/`

Tool files self-register and are discovered automatically. Major tool families:

- File system: `file_tools.py`
- Terminal/processes: `terminal_tool.py`, `process_registry.py`
- Browser automation: `browser_tool.py`, `browser_camofox.py`
- Web search/extraction: `web_tools.py`
- Code execution sandbox: `code_execution_tool.py`
- Delegation/subagents: `delegate_tool.py`
- MCP: `mcp_tool.py`, `mcp_oauth.py`, `mcp_oauth_manager.py`
- Skills: `skills_tool.py`, `skill_manager_tool.py`, `skills_hub.py`, `skills_sync.py`
- Memory/session helpers: `memory_tool.py`, `session_search_tool.py`, `todo_tool.py`
- Messaging/smart-home/media helpers: `send_message_tool.py`, `homeassistant_tool.py`, `tts_tool.py`, `vision_tools.py`, `image_generation_tool.py`

The registry contract lives in `tools/registry.py`. A tool becomes available by calling `registry.register(...)` at module import time.

## Gateway And Cron

- `gateway/` adapts the core agent runtime to external messaging platforms.
- `cron/jobs.py` stores recurring Hermes jobs under `~/.hermes/cron/`.
- `cron/scheduler.py` runs those jobs and re-enters the agent runtime on schedule.

## Extension Rules

If you are adding Hermes features:

- Add tools by creating a new file in `tools/` and registering it.
- Add toolsets in `toolsets.py`.
- Add slash commands through `hermes_cli/commands.py` and the corresponding handler path.
- Use `get_hermes_home()` for stateful paths; do not hardcode `~/.hermes`.

## Important Runtime Caveats

- Prompt caching assumptions matter. Avoid mid-conversation mutations that rebuild past context or toolsets unless the runtime already has a pattern for it.
- `model_tools.py` keeps `_last_resolved_tool_names` as process-global state.
- `SessionDB` is shared and tuned for contention; do not casually replace its transaction behavior.
- Public Hermes docs in `website/docs/` are useful, but code still wins when behavior drifts.
