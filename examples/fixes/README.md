# orders-api

Small Express service that accepts and lists orders.

## Run locally
1. `cp .env.example .env` and fill in the values.
2. `npm install`
3. `npm start` then open http://localhost:3000/health

## Test
`npm test` runs the node:test suite in `tests/`. `npm run lint` runs ESLint.

## Endpoints
- `GET /orders`: list orders
- `POST /orders`: create an order `{ sku, qty, price }` (validated)
- `DELETE /orders/:id`: requires the `x-api-key` header
