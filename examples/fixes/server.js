const express = require("express");
const orders = require("./routes/orders");

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/orders", orders);

app.listen(process.env.PORT || 3000, () => console.log("orders-api listening"));
