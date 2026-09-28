const { test } = require("node:test");
const assert = require("node:assert/strict");
const { orderTotalCents } = require("../lib/orders");

test("computes totals in integer cents without float drift", () => {
  assert.equal(orderTotalCents({ sku: "A", qty: 3, price: 0.1 }), 30);
  assert.equal(orderTotalCents({ sku: "A", qty: 1, price: 19.99 }), 1999);
});
