const express = require("express");
const { validateOrder, createStore } = require("../lib/orders");
const { requireApiKey } = require("../lib/auth");

const router = express.Router();
const store = createStore();

router.get("/", (req, res) => res.json(store.list()));

router.post("/", (req, res) => {
  const result = validateOrder(req.body);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.status(201).json(store.add(result.value));
});

router.delete("/:id", requireApiKey, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
  return store.remove(id) ? res.status(204).end() : res.status(404).json({ error: "not found" });
});

module.exports = router;
