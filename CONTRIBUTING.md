# Contributing

Thanks for improving pyne-agent-worker.

## Setup

```sh
bun install
./scripts/install-hooks.sh
```

## Checks

```sh
./scripts/verify.sh
```

The pre-commit hook runs format, lint, typecheck, and OKF validation. The
pre-push hook adds the test suite. Skip a step for one run with:

```sh
OO_SKIP="lint,typecheck" git commit ...
```

## Pull requests

- Keep one concern per PR.
- Add or update tests for behavior changes.
- Update `okf/` when behavior, commands, or architecture change.
- Use conventional commit messages.
