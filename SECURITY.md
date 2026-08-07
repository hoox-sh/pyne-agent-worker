# Security

## Reporting

Please open a private security advisory on the GitHub repository or contact the HOOX maintainers. Do not file public issues for sensitive reports.

## Secrets

- Never commit `.dev.vars`, `.env`, or API keys.
- Production requires `wrangler secret put API_KEY`.
- Admin endpoints (`/v1/admin/*`) refuse to run when `API_KEY` is unset.

## Content / IP

- This project must not redistribute TradingView® proprietary built-in sources.
- Knowledge-base documents live in private Cloudflare® R2 + Vectorize™.
- Run `bash scripts/legal-check.sh` in CI before deploy.

## Trademarks

Pine Script™ and TradingView® are trademarks of TradingView, Inc.
Cloudflare® is a registered trademark of Cloudflare, Inc.
