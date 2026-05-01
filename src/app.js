const express = require("express");
const cors = require("cors");

// Optional performance packages — install when available:
//   npm install compression express-rate-limit
let compression, rateLimit;
try {
  compression = require("compression");
} catch {
  /* not installed yet */
}
try {
  rateLimit = require("express-rate-limit");
} catch {
  /* not installed yet */
}

//routes
const userRoutes = require("./user-service/routes/user.routes");
const profileRoutes = require("./user-service/routes/profile.routes");
const commonRoutes = require("./common-service/routes/common.routes");
const vendorRoutes = require("./vendor-service/routes/vendor.routes");
const authRoutes = require("./user-service/routes/auth.routes");
const menuRoutes = require("./menu-service/routes/menu.routes");
const orderRoutes = require("./menu-service/routes/order.routes");
const cartRoutes = require("./order-service/routes/cart.routes");
const pusherBeamsRoutes = require("./common-service/routes/pusher-beams.routes");

const path = require("path");

const app = express();

// Trust Render/reverse-proxy's forwarded headers so rate limiting uses the
// real client IP rather than the load-balancer IP.
app.set('trust proxy', 1);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : true; // allow all in dev if CORS_ORIGIN is not set

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-role', 'X-Requested-With'],
};

// Handle CORS preflight — use regex wildcard, Express 5 rejects the '*' string
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

if (compression) app.use(compression());
app.use(express.json({ limit: "1mb" }));

// Rate limiting — 200 requests per 15 minutes per IP
if (rateLimit) {
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: "Too many requests, please try again later." },
    }),
  );
}

// Serve Static Uploads
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use("/users", userRoutes);
app.use("/users", profileRoutes); // Mount profile routes on /users too (e.g. /users/profile)
app.use("/auth", authRoutes);
app.use("/common", commonRoutes);
app.use("/vendor", vendorRoutes);
app.use("/menu", menuRoutes);
app.use("/orders", orderRoutes);
app.use("/cart", cartRoutes);
app.use("/pusher", pusherBeamsRoutes);

// Swagger
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./config/swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Health check
app.get("/health", (req, res) => {
  res.json({
    service: process.env.SERVICE_NAME,
    status: "UP",
  });
});

// Global error handler — never expose stack traces to clients
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (err.message || 'Internal server error')
  });
});

module.exports = app;
