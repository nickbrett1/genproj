# Specs

Design documents for this service, in the order they were written:

| Spec                                                                               | What it covers                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`001-genproj`](001-genproj/spec.md)                                               | The service itself: catalog, generation, conflicts, the API contract (`contracts/api.yaml`).                                        |
| [`003-genproj-docker-container`](003-genproj-docker-container/spec.md)             | The `docker-container` capability and its contract.                                                                                 |
| [`006-genproj-buildkite`](006-genproj-buildkite/spec.md)                           | The `buildkite` capability and its contract.                                                                                        |
| [`007-genproj-github-release`](007-genproj-github-release/spec.md)                 | The `github-release` capability and its contract.                                                                                   |
| [`008-genproj-container-agent`](008-genproj-container-agent/spec.md)               | The `container-agent` capability and its contract: every devcontainer's own registered agent.                                       |
| [`009-genproj-micropython-lint`](009-genproj-micropython-lint/spec.md)             | Defect record: `micropython` + `code-quality-python` firmware layout, the ruff target, and the README CI claim.                     |
| [`010-genproj-micropython-board-chip`](010-genproj-micropython-board-chip/spec.md) | Defect record: the `micropython.board` product/chip conflation (new `chip` axis), and the CI-mention refinement.                    |
| [`011-genproj-catalog-categories`](011-genproj-catalog-categories/spec.md)         | The catalog owns the UI's sections: a top-level `categories` block, and the client that renders it instead of keeping its own list. |

They were written while the generator lived inside the front-end repository and
moved here with the code. Read them as the reasoning behind the current shape,
not as a plan of work in progress: where a spec and the code disagree, the code
is what runs.

Specs 001 and 003 predate the split of the front-end out of this service, so
anything they say about the UI, sessions or sign-in describes the client, not
this repository.
