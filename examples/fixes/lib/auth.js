const { timingSafeEqual } = require("node:crypto");

/** Constant-time comparison so the key can't be guessed byte by byte. */
function safeEqual(/** @type {string} */ a, /** @type {string} */ b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** @type {import("express").RequestHandler} */
function requireApiKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  const given = req.get("x-api-key") || "";
  if (!expected || !safeEqual(given, expected)) return res.status(401).json({ error: "unauthorized" });
  return next();
}

module.exports = { requireApiKey, safeEqual };
