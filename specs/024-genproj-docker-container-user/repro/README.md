# spec 024 runtime verification — reproduction artifacts

These are the artifacts from the runtime verification recorded in
`memos/genproj-docker-user-runtime-verification.md` (2026-11-04, `main` @
`3f63038`). They are kept so the evidence can be re-run rather than taken on
trust; none of them is generated output that ships.

| file                 | what it is                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `render.mjs`         | renders the test project through the real `generateAllFiles`, so the Dockerfile under test is the shipped one |
| `Dockerfile.pos`     | the shipped-order Dockerfile produced by that render (`USER` last)                                            |
| `docker-compose.yml` | the generated compose file, showing `user: "1000:1000"`                                                       |

## Re-running

```sh
node specs/024-genproj-docker-container-user/repro/render.mjs
# writes ./proj (gitignored) next to this README
```

The generated project still needs an entrypoint at `scripts/verify024.sh`. The
script used for the run was not preserved; it printed `id -u` / `id -g`, the
`ls -l` of itself, and exited 0 on `--dry-run`. The negative-order Dockerfile
(`Dockerfile.neg`, `USER` moved above `COPY`/`chmod`) and its build context were
also not preserved — only the result is recorded in the memo.

A Docker daemon is required to build; the workspace used for the original run
had none and the build was executed on a host that did.
