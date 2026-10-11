# Memo: the generated Python image must import and answer its own healthcheck

Status: PR open. Author: goose. Date: 2026-10-11.
Branch: `fix/python-image-importable-and-serves-healthcheck`.

Two defects in the generated `docker-container` image for a Python project,
each of which makes a freshly generated project fail the smoke step that
genproj itself emits. Both live in `capability-template-utils.js` (the
Dockerfile emitter) and `file-generator.js` (the Python scaffold).

## Defect 1 — the image can ship a stale stub `__init__.py`

The build stage used to cache-prime with a placeholder package before the
source copy:

```dockerfile
COPY README.md pyproject.toml* requirements.txt* ./
RUN ... && mkdir -p src/<pkg> && touch src/<pkg>/__init__.py \
    && ... && pip install --no-cache-dir .
COPY . .
RUN ... && pip install --no-cache-dir --no-deps .
```

That shape is cache-dependent. The first install leaves a setuptools
`build/lib/<pkg>/__init__.py` stub in the image; the post-COPY `--no-deps`
"reinstall" can skip re-copying a source file whose mtime is older than that
artifact — exactly what a warm BuildKit layer cache produces. The wheel then
ships the empty stub, `python -m <pkg>` dies with
`cannot import name '__version__' from '<pkg>'`, and the container never
serves.

**Fix.** Install ONCE, from the fully copied source:

```dockerfile
COPY . .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && if [ -f requirements.txt ]; then
         grep -vE '^\s*(-e|--editable)\s+\.' requirements.txt > /tmp/reqs.txt || true;
         ...
       fi \
    && if [ -f pyproject.toml ]; then /opt/venv/bin/pip install --no-cache-dir .; fi
```

The editable-self-install filter stays: an `-e .[dev]` local reference needs
the real source, which is now present (nas-port-mcp bug 2). The manifest-first
layer ordering is intentionally abandoned for Python only; Node/Java/Rust keep
it.

## Defect 2 — the default CMD cannot satisfy an `http:/...` healthcheck

The smoke step runs the built image with **no command override** while polling
the **declared** healthcheck. The old default for Python was stdio:

```dockerfile
CMD ["python", "-m", "<pkg>"]
```

A stdio process exits immediately, so an `http:/...` probe never passes and
the container restart-loops (notes-mcp).

**Fix.** When an http healthcheck is declared and no serving harness already
answers it, the default CMD selects the HTTP transport on the `EXPOSE` port:

```dockerfile
CMD ["python","-m","<pkg>","--transport","streamable-http","--host","0.0.0.0","--port","<port>"]
```

`file-generator.js` grows `buildPythonTransportEntrypoint()`: the scaffold
`__main__.py` now has a `stdio | streamable-http` switch, **defaulting to
stdio**, so a local client still runs `python -m <pkg>` with no arguments and
gets stdio unchanged. The HTTP branch is a stdlib `ThreadingHTTPServer` that
answers the declared path with `{"status": "ok"}` and 404s everything else —
zero runtime dependencies. The smoke gate in
`capability-template-utils.js` mirrors the same condition
(`smokePythonServesHttp`) so the Dockerfile CMD and the gate agree.

## Tests

- `tests/generator/dockerfile-build-order.test.js` — the Python spec now
  asserts `fetchBeforeCopy: false` (the install follows `COPY . .`) and the
  build step is the single venv+install `RUN`.
- `tests/generator/file-generator-python.test.js` — the build-order assertion
  flips to install-once, and a new
  `Python image contract (regressions: stale stub + healthcheck CMD)` block
  holds one regression per defect:
  - defect 1: no pre-COPY stub install, no `--no-deps`, exactly one
    `pip install .` after the copy, and the scaffold `__init__.py` defines
    `__version__`;
  - defect 2: the default CMD is the streamable-http one and the emitted
    `__main__.py` declares `HEALTH_PATH = "/healthz"` / `default="stdio"`.

## Verification

- `npx vitest run` -> **873 passed (61 files)**.
- `npm run lint` -> 0 errors.
- `npm run build:templates` -> `templates.generated.js` unchanged (the
  Dockerfile is emitted in code, not from a template).

## Scope

The branch is cut from `main` and carries **only** the two Dockerfile fixes
and their tests (commit `45d6f78`). An unrelated "private repository" feature
(`project-context.js`, `project-generator.js`, `mcp/server.js` + tests) and
the homepage widget-URL change were deliberately left out.
