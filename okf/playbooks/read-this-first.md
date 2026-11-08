---
type: Playbook
title: Read this first
description: The shortest path into the knowledge bundle.
tags: [playbook, onboarding]
status: stable
okf_lock: human
---

# Read this first

1. Read [Architecture](../architecture.md) for the project shape and the team.
2. Read [Development](../development.md) before changing code.
3. Read [Security](../security.md) before changing permissions or gates.

## The one-paragraph model

One bot per domain. Rules live in the description, not in memory. Proof comes
before "done". One front door routes and never builds. A board replaces a group
chat. Routines live on their own bot. Gate on the price of undo.

## When you change behavior

- Update the code and tests.
- Update `README.md` and the matching `okf/` concept.
- Run `./scripts/verify.sh` before you report work as done.
