# Fork notes

This is [shuv1337/stream-deck-herdr-plugin](https://github.com/shuv1337/stream-deck-herdr-plugin),
a maintained fork of
[timvdhoorn/stream-deck-herdr-plugin](https://github.com/timvdhoorn/stream-deck-herdr-plugin)
(MIT, © Tim van der Hoorn — see `LICENSE`).

- Forked from upstream `8baa557` (feat: add a Display setting …).
- Upstream merges are expected: `git fetch upstream && git rebase upstream/master`
  (the `upstream` remote is timvdhoorn, `origin` is shuv1337).

## Why a fork

The fork tracks the [shuv1337/herdr](https://github.com/shuv1337/herdr) fork of
herdr (0.9.x, API protocol 22) and a Stream Deck XL on Linux/OpenDeck, which
upstream does not target. See the README for the feature set.

## Identity contract

| class | identifier | decision |
|-------|------------|----------|
| compatibility | plugin UUID `dev.timvdhoorn.herdr-agents` and the `.sdPlugin` directory name | **preserved** — OpenDeck/Stream Deck profiles, installed plugin paths, and per-key settings are keyed on it; renaming would orphan every existing layout |
| compatibility | action UUIDs `dev.timvdhoorn.herdr-agents.{slot,pager,summary,toggle-idle,input}` | **preserved** (new actions keep the same prefix for the same reason) |
| compatibility | settings keys `slotIndex`, `display`, `mode`, `keys`, `text`, `label` | **preserved** |
| compatibility | env vars `HERDR_DECK_*`, `HERDR_SOCKET_PATH`, `HERDR_SESSION` | **preserved** |
| canonical | display name `herdr agents`, category `herdr` | **kept** — the product is still "herdr on a Stream Deck"; no rebrand |
| canonical | repository URL in `manifest.json`, README clone/install instructions | **fork** |
| provenance | `LICENSE`, `Author` in `manifest.json`, README license line, git history | **kept** |

`tests/fork-boundary.test.ts` asserts the rows above so an upstream rebase cannot
blur them silently.

## Deliberate deltas from upstream

- Direct NDJSON socket client instead of spawning the `herdr` CLI; `session.snapshot`
  for sidebar order + workspace labels; per-pane `pane.agent_status_changed`
  subscriptions (the only form herdr accepts).
- Dynamic slot count with coordinate-based auto numbering; Summary, Toggle Idle,
  Agent Input actions; Pager modes.
- Label chain `name → workspace label → cwd` (upstream's `project`/`title` Display
  modes are kept as options).
- Base64 SVG data URIs (OpenDeck renders percent-encoded ones black).
- Hyprland terminal raise matches herdr's real `{hostname}: {workspace}` title.
- `scripts/opendeck-profile.ts` + `scripts/install-opendeck.sh` for Linux installs.
