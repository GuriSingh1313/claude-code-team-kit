// DEMO FIXTURE: intentionally insecure. The values below are fake and exist only
// so the readiness audit has something realistic to find.
const express = require("express");
const orders = require("./routes/orders");

const PAYMENT_API_SECRET = "4f9d2c7b1e8a6035d9c4b7e2a1f08c63";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  if (req.headers["x-payment-signature"] && req.headers["x-payment-signature"] !== PAYMENT_API_SECRET) {
    return res.status(401).send("bad signature");
  }
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/orders", orders);

app.listen(process.env.PORT || 3000, () => console.log("orders-api listening"));
