---
name: mock-first-api
description:
  How to build UI against a hand-written mock when the real backend API
  doesn't exist yet, so the eventual swap to the real endpoint needs no
  call-site changes. Covers the mock service module, the swap-point comment
  convention, and how to flag an unconfirmed data shape for the API team. Use
  whenever a spec's Implementation Details say "no API exists yet," "API team
  will provide this later," or similar — even if the spec doesn't name this
  skill directly.
---

# Mock-First API

For building a real UI feature whose backend endpoint doesn't exist yet,
without leaving behind a dead, duplicate implementation once the real
endpoint lands.

## When this applies

- The spec says the API isn't ready, or that the API team will provide a
  contract/mock payload later.
- **Doesn't apply** once a real endpoint already exists, even if you're
  integrating against it for the first time — that's ordinary spec work.

## Core rule: the mock lives inside the real call site, not next to it

Write the actual service module the UI will call (`fetchX()`, `mutateX()`,
whatever the feature needs) in the project's own API layer, following its
existing file naming and location conventions (`03-code-standards.md`, or
wherever the project documents them). The UI imports and calls this
file exactly as it will once the real API exists.

Internally, the function body just returns hardcoded mock data (an optional
simulated delay helps test loading states realistically). This is the *only*
implementation — never also create a second, unused "real" implementation
alongside it. A parallel, zero-call-site implementation is exactly the
anti-pattern `03-code-standards.md` already flags (Pattern #4: dead mock code
committed alongside real code); the twist here is there's no real code yet,
so don't manufacture a second file pretending otherwise.

## Mark the swap point explicitly

Every mock function needs a comment naming exactly what changes once the real
endpoint lands, so the eventual swap needs no call-site changes elsewhere in
the app:

```ts
// TODO(API): replace mock impl with the project's real API client call
// once the <name> endpoint exists. Do not change the function signature
// below, only the body.
```

## Flag the data shape as unconfirmed

If the mock's shape (fields, types) hasn't actually been agreed with a real
backend team, say so in the spec's Dependencies or Data Model section — e.g.
"Mock shape (unconfirmed, flag for the API team when the real contract
arrives)." Don't let an invented shape read as a settled contract.

## When the real API arrives: amend, don't rewrite

Per the completed-specs-are-immutable rule in `04-ai-workflow-rules.md`, a spec that's already Completed with
a mock stays immutable. Integrating the real API is a new amendment spec
(`docs/specs/_amendment-template.md`) against the original — typically small:
swap the mock body for the real API client call, reconcile any drift
between the mock shape and the real contract, and remove the TODO(API)
comment.

## Quick checklist

- [ ] Mock lives inside the real API-layer module the UI actually calls — no
      parallel dead file.
- [ ] Function signatures match what the real endpoint is expected to have.
- [ ] TODO(API) swap-point comment present, naming the exact endpoint to wire
      up later.
- [ ] Mock data shape flagged as unconfirmed if not agreed with a backend
      team.
- [ ] Mock-backed state is not persisted (for example to local storage), so
      stale mock data can't outlive the swap, unless `02-architecture.md`
      says otherwise.
