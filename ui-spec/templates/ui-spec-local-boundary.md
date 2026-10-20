# UI spec: local-only boundary

Design assets for client work are sensitive. This page says what stays on the developer's Mac, what may go to an
agent, and how to check it. Read it before touching anything under `docs/design/`.

## What leaves the machine, and what does not

| Item | Contains | Where it lives | May go to an agent or the repo |
|---|---|---|---|
| Screenshot or Figma export | the design | private folder only | **No**, never |
| `<name>.overlay.png` | the design with boxes drawn on it | private folder only | **No** |
| `<name>.items.json` | boxes plus the exact copy read from the design | private folder only | **No** |
| `<name>.textmap.local.json` | the real copy behind `[T1]`, `[T2]`... | private folder only | **No** |
| `<screen>.spec.md` / `.spec.json` | boxes, roles, copy (or `[T1]` placeholders with `--redact`) | `docs/design/specs/` | Yes, after the copy check below |
| `tests/ui-spec/<screen>.spec.ts` | the same boxes, copy in text assertions | repo | Yes (it is code in the client repo) |

The private folder is outside every repository, for example `~/ui-spec-private/`. It is not inside a
cloud-synced folder (iCloud Drive, Dropbox, OneDrive) and not inside any project that an agent opens.

## What "local" means in practice

- The vision model runs in `llama-server` bound to `127.0.0.1:8080`. The tools refuse any endpoint that is not loopback.
- `describe` reads the screenshot from disk and sends it only to that endpoint. Nothing else is sent anywhere.
- The only online steps are installing the tools and downloading the model weights. Both happen before any client
  design is on the machine and carry no client data.
- The generator and the test runner never contact a model.

Check it yourself instead of trusting this page:

1. `lsof -nP -iTCP:8080 -sTCP:LISTEN` must show `127.0.0.1:8080`. If it shows `*:8080`, restart `llama-server` with `--host 127.0.0.1`.
2. For the strictest run, turn Wi-Fi and Ethernet off, start the server from disk, and run `describe`. It must work unchanged.
3. Optional: a macOS outbound firewall (for example Little Snitch or LuLu) with `llama-server` and `node` set to deny non-loopback.

## Keep agents out of the private folder

An agent session on this Mac can read any file it can reach. Two guards:

1. Never open an agent session with the private folder as its working directory or inside it.
2. In the client repo, deny reads of design paths, in `.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Read(./docs/design/private/**)",
      "Read(**/*.overlay.png)",
      "Read(**/*.items.json)",
      "Read(**/*.textmap.local.json)"
    ]
  }
}
```

Add the same patterns to `.gitignore`, and keep any stray design file out of commits:

```
docs/design/private/
*.overlay.png
*.items.json
*.textmap.local.json
```

(Check the current Claude Code settings reference for the exact deny syntax before relying on it.)

## Before a table goes into a spec, a commit or a chat

1. Open `<screen>.spec.md`. Is every `text` value safe to share? Names, account numbers, internal product names,
   real customer data in sample rows?
2. If not, rerun `spec` with `--redact`. The table then has `[T1]`, `[T2]`... and the real copy is written to
   `textmap.local.json`, which stays private.
3. To build tests that still check the copy, generate them on the Mac with
   `--textmap=<path to textmap.local.json>`. The real copy then appears only in `tests/ui-spec/`, in the client repo.
4. Search the table for the client name and for obvious identifiers (`grep -i`). Delete any hit by re-running with `--redact`.
5. The table has no colors or fonts. Do not add any from the design: tokens are the source.

## If something sensitive was shared by mistake

Stop the session, tell the project owner, and delete the file and any generated copies. Do not try to talk the
agent into forgetting it. If it entered a chat or a pushed commit, treat it as a disclosure under the client contract.

## Why the tools are built this way

- Measuring is done by a local model plus a pixel script, so no design pixels ever need to be uploaded.
- The output is a typed table, which is small, diffable, reviewable and safe to share once the copy is checked.
- Tests check the built page against the table, so the agent is held to the numbers instead of to a picture it cannot see.
