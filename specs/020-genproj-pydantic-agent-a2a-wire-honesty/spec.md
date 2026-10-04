# 020 — the pydantic-agent A2A server is wire-honest (a2a-sdk, not FastA2A)

**Status:** implemented (2026-10-04).

This is a defect record. It writes down what the generated `pydantic-agent`
A2A server got wrong, what the fix is, and how it is pinned — so the reasoning
survives the code.

## The defect

`src/generator/templates/pydantic-agent-main-py.template` generated an A2A
server built on **FastA2A** (`fasta2a[pydantic-ai]>=2.0`, latest release
2.0.1). FastA2A 2.0.1 hard-codes the served agent card's JSONRPC interface
version to `"1.0"` (`fasta2a/applications.py`), while its JSON-RPC endpoint only
accepts the legacy **0.3** dialect (`message/send`). **The card lied about the
wire.**

The LiteLLM gateway invokes agents with an **`a2a-sdk` 1.1.0** client
(litellm 1.105.0). That client reads the card's
`supportedInterfaces[].protocolVersion` to choose a transport: a `0.3.x` version
sends `message/send`; anything else sends `SendMessage`. Because the FastA2A card
claimed `1.0`, the gateway sent `SendMessage`, which FastA2A's 0.3 parser
rejected:

```
Input tag 'SendMessage' found using 'method' does not match any of the expected
tags: 'message/send', 'message/stream', 'tasks/get', ...
```

FastA2A 2.0.1 is the **latest release** — 0.3.4→0.3.7, 0.4.0/0.4.1, 0.5.0,
0.6.0/0.6.1, 1.0.0, 2.0.0, 2.0.1 — so the client/server skew is permanent for
that library. A workaround on the generated card (rewriting the interface to
`0.3`) only moved the failure: it exposed `message/send.params.configuration.
acceptedOutputModes Field required`, and then LiteLLM's
`Response has neither task nor message` — a second, deeper skew between the
gateway's client and FastA2A's envelope.

The pattern, stated plainly: **a green registration is not evidence of a working
agent**, and a card that advertises a dialect the endpoint rejects makes every
turn fail before the agent runs. LiteLLM carries a mitigation
(`normalize_agent_card_interfaces`) for servers that speak `0.3` while declaring
`1.0`, but it fires only on a **mis-cased** binding; our correctly-cased
`JSONRPC` slipped past it.

## The fix — serve with the SDK the caller already uses

Replace FastA2A with the **official `a2a-sdk` server** — the same library that
ships the gateway's client — and **pin the server to the client's version**,
`a2a-sdk[http-server]==1.1.0` (not 1.2.x, which is newer than the gateway's
client and would re-introduce skew).

- `agent/main.py` now builds a Starlette app from `a2a.server`:
  `DefaultRequestHandler` + `create_agent_card_routes` + `create_jsonrpc_routes`,
  with a `PydanticAIAgentExecutor` (`AgentExecutor`) wrapping the Pydantic AI
  agent and publishing a task via `TaskUpdater`.
- The served card is an `a2a.types.AgentCard` whose JSONRPC interface
  `protocol_version` is `PROTOCOL_VERSION`, and the endpoint is configured to
  accept exactly the dialects in `SUPPORTED_DIALECTS`. **Both come from one
  value.** `create_app()` enables the SDK's 0.3 backward-compat adapter iff
  `"0.3"` is in `SUPPORTED_DIALECTS`, so the card can never claim a dialect the
  endpoint rejects.
- `agent/card.py` emits the skills as **plain dicts**, not SDK constructors:
  the same list builds the served card (`AgentSkill(**skill)`) and is sent to
  LiteLLM as JSON, so the served card and the registered card cannot drift.
- `agent/headers.py` reads the `X-LiteLLM-*` headers from the SDK call context
  (`context.call_context.state["headers"]`) into a turn-scoped context variable;
  `HeaderForwardingClient` injects them on outbound model calls. This replaces
  FastA2A's JSON-RPC-metadata plumbing, which no longer exists.

### Dialect choice: **1.0**

The generated server speaks **A2A 1.0** — `a2a-sdk`'s native, default dialect
(`SendMessage` with the `A2A-Version: 1.0` header) — and advertises `1.0`
truthfully. The 1.1.0 client sends `A2A-Version: 1.0` on its 1.0 transport, so
client and server agree by construction. `0.3` remains reachable by adding it to
`SUPPORTED_DIALECTS` (one line), which turns on the compat adapter; either
dialect is honest **as long as the card says what the endpoint serves**. 1.0 is
chosen because it is the SDK's native path and matches LiteLLM's registration
default.

## Constraints held

- **`PromptedOutput(AgentResult)`** is the output mode — not the default
  `ToolOutput` and not `NativeOutput`. On a thinking model
  (`deepseek-v4-flash`) forced `tool_choice` returns
  `Thinking mode does not support this tool_choice` and `json_schema`
  `response_format` returns `This response_format type is unavailable now`;
  `PromptedOutput` works.
- The **output validator hook** (`validate_agent_result` / `ModelRetry` repair
  loop) and `retries={"output": maxOutputRetries}` are unchanged.
- **`ModelSettings(max_tokens=4096)`** — reasoning tokens bill against
  `max_tokens`, so a small cap truncates the answer.
- Registration (`agent/register.py`), the card shape, the `proxy_admin`
  user-key credential, fail-open, the listing-filter fallback, ports and the
  app-owned paths are unchanged. The registration payload still carries
  `protocolVersion`.

## How it is pinned

- `tests/generator/pydantic-agent.test.js` → _pydantic-agent wire honesty_:
  the emitted `agent/main.py` imports the `a2a-sdk` server (and no FastA2A);
  the advertised dialect is derived from the accepted set (`PROTOCOL_VERSION` /
  `SUPPORTED_DIALECTS` / `SEND_METHOD_BY_DIALECT`); `PromptedOutput`,
  `ModelSettings(max_tokens=4096)` and the validator loop are present; the
  generated wire test is emitted; skills are dicts. `pyproject.toml` pins
  `a2a-sdk[http-server]==1.1.0` and contains no `fasta2a`.
- **The scaffold's own suite** (`tests/test_a2a_wire.py`, generated into every
  `pydantic-agent` project and run by its `pytest`) asserts that the **served**
  card's JSONRPC interface `protocolVersion` is a dialect the server accepts,
  and dials the real JSON-RPC endpoint with that dialect's send method to prove
  it is routed (an un-routed method earns `-32601 "method not found"`). This is
  the test that would have caught the FastA2A defect.

## Provenance

Diagnosed and fixed in `genproj` from the incident trail in memos
`bdJPHqLM2jJPaqDnLFhQDW`, `ErGSj2mJ3AneLbbK33WBZB` and
`6qUPexUdWAr53XbEbXi3nM`. Every generated `pydantic-agent` project — starting
with `data-sourcing-agent` — inherits the defect until regenerated or patched;
this record is the upstream fix.
