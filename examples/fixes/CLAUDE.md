# orders-api

Express service for creating and listing orders. Used by the storefront checkout.

## Commands
- Test: `npm test`
- Lint: `npm run lint`
- Run locally: `npm start`

## Architecture
| Path | Responsibility |
|---|---|
| `server.js` | App setup, middleware, route mounting |
| `routes/` | HTTP layer only: parse, validate, respond |
| `lib/` | Pure business logic (validation, totals, store); unit-tested |
| `tests/` | node:test suites for `lib/` |

## Conventions
- Keep business logic in `lib/` as pure functions; routes stay thin.
- Money is integer cents (`totalCents`), never floats.
- Validation returns `{ ok, value | error }` instead of throwing.

## Definition of done
- `npm run lint` and `npm test` pass (the Stop hook enforces tests).
- New behaviour has a test in `tests/`.
- Secrets come from environment variables listed in `.env.example`.

## Don't
- Don't read or print `.env`.
- Don't add a database layer without an ADR; the in-memory store is intentional for now.
