const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("../lib/orders");
const { safeEqual } = require("../lib/auth");

test("store assigns ids and deletes by exact numeric id", () => {
  const store = createStore();
  const a = store.add({ sku: "A", qty: 1, price: 1 });
  store.add({ sku: "B", qty: 1, price: 1 });
  assert.equal(store.remove(a.id), true);
  assert.equal(store.remove(a.id), false);
  assert.deepEqual(store.list().map((o) => o.sku), ["B"]);
});

test("api key comparison is exact", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});
