# Agent Instructions

## Project Summary
This repository contains a cross-platform CLI for managing Hostinger hosted websites.
The CLI uses:
- Hostinger public API to list domains and confirm ownership.
- SFTP (SSH) for file operations on shared hosting.

## Key Behaviors
- `hostinger` with no args starts an interactive shell.
- The shell supports: `help`, `domains`, `connect <domain>`, `disconnect`, `pwd`, `root`, `cd`, `ls`, `mkdir`, `rm`, `put`, `get`, `replace`, `update`, `open`, `exit`.
- `connect <domain>` sets the active site and computes a remote root like `/home/<username>/domains/<domain>/public_html`.
- If the root is wrong, `root auto` attempts to detect the correct root.

## Architecture
- `src/index.ts`: CLI entrypoint + top-level commands + shell boot.
- `src/shell.ts`: interactive shell, command routing, and SFTP flows.
- `src/api/*`: Hostinger API client for listing websites.
- `src/sftp/*`: SFTP connection helpers and remote filesystem utilities.
- `src/sync/*`: directory sync logic.
- `src/utils/*`: path helpers, output formatting, open/temporary utilities.

## Config & Secrets
- Config is stored outside the repo:
  - macOS/Linux: `~/.config/hostinger/config.json`
  - Windows: `%APPDATA%/hostinger/config.json`
- API tokens and SFTP credentials are stored there, never in the repo.
- Do not commit any config files or credentials.

## Defaults & Assumptions
- SFTP port default: `65002` (Hostinger shared hosting SSH/SFTP).
- Remote root default is computed from the domain + username when possible.
- SFTP credentials often apply across all domains on the same hosting plan.

## Development Notes
- Node.js + TypeScript project.
- Build: `npm run build` (outputs to `dist/`).
- Global dev usage: `npm link` then run `hostinger` from anywhere.

## Editing Guidance
- Keep terminal output concise and helpful.
- Avoid adding platform-specific or user-specific assumptions.
- Maintain ASCII-only in source files unless required.
