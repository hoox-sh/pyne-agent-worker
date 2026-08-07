# Copyright (c) 2026 HOOX · PYNE · jango-blockchained
# SPDX-License-Identifier: AGPL-3.0-or-later

.PHONY: install dev test typecheck legal deploy

install:
	bun install

dev:
	bun run dev

test:
	bun test tests/

typecheck:
	bun run typecheck

legal:
	bash scripts/legal-check.sh

deploy: legal
	bun run deploy
