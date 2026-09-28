const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateOrder } = require("../lib/orders");

test("accepts a well-formed order and trims the sku", () => {
  assert.deepEqual(validateOrder({ sku: " A-1 ", qty: 2, price: 9.99 }), { ok: true, value: { sku: "A-1", qty: 2, price: 9.99 } });
});

test("rejects missing sku, bad qty and negative price", () => {
  assert.equal(validateOrder({ qty: 1, price: 1 }).ok, false);
  assert.equal(validateOrder({ sku: "A", qty: 0, price: 1 }).ok, false);
  assert.equal(validateOrder({ sku: "A", qty: 1.5, price: 1 }).ok, false);
  assert.equal(validateOrder({ sku: "A", qty: 1, price: -1 }).ok, false);
  assert.equal(validateOrder(null).ok, false);
});
