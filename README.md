# claude-customizations

Personal Claude Code mods, published as one plugin marketplace (`claude-customizations`).

| Mod | What it does |
| --- | --- |
| [unclutter](mods/unclutter) | Collapses tool and MCP results to one line; details open in a side pane with the goal, highlighted input and output. `j`/`k` walk the calls. |

## Install

### On a machine that has this repo checked out (development)

Add the working copy as a marketplace. Claude Code then reads each mod straight from this folder: no symlinks, no copies.

```bash
claude plugin marketplace add ~/workspace/personal/claude-customizations
claude plugin install unclutter@claude-customizations --scope user
```

After editing a mod, run `/reload-plugins` in Claude Code to pick up the change.

### On any other machine

From GitHub, typed at the Claude Code prompt:

```
/plugin install unclutter --marketplace <owner>/claude-customizations
```

Or from any git remote:

```bash
claude plugin marketplace add <git-url>
claude plugin install unclutter@claude-customizations --scope user
```

These installs run a copy made at install time. Pull in new commits with `claude plugin marketplace update claude-customizations`, then `claude plugin update unclutter@claude-customizations` and `/reload-plugins`.

## Configure

Each mod's options are in `/config`, or:

```bash
claude plugin configure unclutter@claude-customizations
```

## Repository layout

```
.claude-plugin/marketplace.json   lists every mod in this repo
mods/<mod>/                       one folder per mod
  .claude-plugin/plugin.json      manifest: name, version, userConfig options
  hooks/hooks.json                points at the hooks module
  hooks/register.tsx              the mod itself
  types/index.d.ts                $.state contract (when the mod keeps state)
  tests/*.test.ts                 run with `claude plugin test`
scripts/check.sh                  validates the marketplace and tests every mod
```

## Add a mod

1. Create `mods/<mod>/` with at least `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.tsx`.
2. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<mod>", "source": "./mods/<mod>" }`.
3. Run `./scripts/check.sh <mod>`.
4. `claude plugin marketplace update claude-customizations`, then `claude plugin install <mod>@claude-customizations --scope user`.

Bump `version` in a mod's `plugin.json` when you change it, so `claude plugin update` picks it up on other machines.
