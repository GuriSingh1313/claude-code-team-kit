// DEMO FIXTURE: a typical AI-generated route with no validation and no tests.
const express = require("express");
const router = express.Router();

const db = { orders: [] };
const db_password = "orders-demo-password-2026";

router.get("/", (req, res) => res.json(db.orders));

router.post("/", (req, res) => {
  const order = { id: db.orders.length + 1, ...req.body, total: req.body.qty * req.body.price };
  db.orders.push(order);
  res.status(201).json(order);
});

// TODO: add auth before launch
router.delete("/:id", (req, res) => {
  db.orders = db.orders.filter((o) => o.id != req.params.id);
  res.status(204).end();
});

module.exports = router;
module.exports.db_password = db_password;
