# Before / after: orders-api

Reproduce with `npm run demo`. The prototype is in `examples/vibe-coded-app`, the fixes in `examples/fixes`.

| Stage | Score | Grade | Report |
|---|---|---|---|
| Vibe-coded prototype, as delivered | **9/100** | F | [1-before.md](1-before.md) |
| After installing the kit (1 command) | **41/100** | D | [2-after-kit.md](2-after-kit.md) |
| After the senior-engineer fixes | **100/100** | A | [3-after-fixes.md](3-after-fixes.md) |

What changed in the last step: secrets moved to environment variables (and the committed `.env` removed),
business logic extracted to `lib/` with tests, input validation and an API-key check on DELETE,
ESLint + `checkJs`, a CI workflow that also gates on this audit, and a CLAUDE.md written from the code.
