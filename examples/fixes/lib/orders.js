// Pure order logic, extracted from the route so it can be tested without a server.

/** @typedef {{ sku: string, qty: number, price: number }} OrderInput */

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: OrderInput } | { ok: false, error: string }}
 */
function validateOrder(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be an object" };
  const { sku, qty, price } = /** @type {Record<string, unknown>} */ (body);
  if (typeof sku !== "string" || sku.trim() === "") return { ok: false, error: "sku is required" };
  if (!Number.isInteger(qty) || /** @type {number} */ (qty) <= 0) return { ok: false, error: "qty must be a positive integer" };
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return { ok: false, error: "price must be a non-negative number" };
  return { ok: true, value: { sku: sku.trim(), qty: /** @type {number} */ (qty), price } };
}

/** Total in cents, avoiding floating point drift. */
function orderTotalCents(/** @type {OrderInput} */ order) {
  return Math.round(order.price * 100) * order.qty;
}

function createStore() {
  /** @type {Array<OrderInput & { id: number, totalCents: number }>} */
  const orders = [];
  let nextId = 1;
  return {
    list: () => [...orders],
    add(/** @type {OrderInput} */ input) {
      const order = { id: nextId++, ...input, totalCents: orderTotalCents(input) };
      orders.push(order);
      return order;
    },
    remove(/** @type {number} */ id) {
      const index = orders.findIndex((o) => o.id === id);
      if (index === -1) return false;
      orders.splice(index, 1);
      return true;
    },
  };
}

module.exports = { validateOrder, orderTotalCents, createStore };
