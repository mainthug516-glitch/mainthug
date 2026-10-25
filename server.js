require("dotenv").config();

const argon2 = require("argon2");
const connectSqlite3 = require("connect-sqlite3");
const cors = require("cors");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const sqlite3 = require("sqlite3");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_COOKIE = "luma.sid";
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const DATABASE_DIR = path.resolve(process.env.DATABASE_DIR || "./data");

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid port number.");
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith("generate-")) {
  throw new Error("Set SESSION_SECRET to a unique random value of at least 32 characters.");
}
if (COOKIE_SECURE && process.env.FRONTEND_ORIGIN?.startsWith("http://")) {
  throw new Error("Production FRONTEND_ORIGIN must use HTTPS.");
}

fs.mkdirSync(DATABASE_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DATABASE_DIR, "luma.sqlite"));
db.configure("busyTimeout", 5000);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeTokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function requireCsrf(req, res, next) {
  if (!safeTokenEqual(req.get("X-CSRF-Token"), req.session.csrfToken)) {
    return sendError(res, 403, "Your session expired. Refresh the page and try again.");
  }
  next();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function establishSession(req, res, user, message) {
  req.session.regenerate((regenerateError) => {
    if (regenerateError) return res.status(500).json({ success: false, message: "Could not create a secure session." });
    req.session.userId = user.id;
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ success: false, message: "Could not save the secure session." });
      res.json({ success: true, message, user: publicUser(user), csrfToken: req.session.csrfToken });
    });
  });
}

async function start() {
  await new Promise((resolve, reject) => {
    db.exec(
      `PRAGMA journal_mode = WAL;
       CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         email TEXT NOT NULL UNIQUE COLLATE NOCASE,
         phone TEXT NOT NULL,
         password_hash TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );`,
      (error) => (error ? reject(error) : resolve())
    );
  });

  const app = express();
  const SqliteStore = connectSqlite3(session);

  app.disable("x-powered-by");
  if (COOKIE_SECURE) app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]
      }
    }
  }));

  if (FRONTEND_ORIGIN) {
    let originUrl;
    try {
      originUrl = new URL(FRONTEND_ORIGIN);
    } catch {
      throw new Error("FRONTEND_ORIGIN must be an absolute origin such as https://www.example.com.");
    }
    if (originUrl.origin !== FRONTEND_ORIGIN || (COOKIE_SECURE && originUrl.protocol !== "https:")) {
      throw new Error("FRONTEND_ORIGIN must be an origin only, and use HTTPS in production.");
    }
    app.use(cors({
      origin(origin, callback) {
        if (!origin || origin === FRONTEND_ORIGIN) return callback(null, true);
        const error = new Error("This website origin is not allowed.");
        error.status = 403;
        callback(error);
      },
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"]
    }));
  }

  app.use(express.json({ limit: "10kb" }));
  app.use(session({
    name: SESSION_COOKIE,
    secret: SESSION_SECRET,
    store: new SqliteStore({
      db: "sessions.sqlite",
      dir: DATABASE_DIR,
      table: "sessions",
      concurrentDB: true
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/"
    }
  }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many account attempts. Please wait and try again." }
  });

  app.get("/api/auth/csrf", (req, res, next) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save((error) => {
      if (error) return next(error);
      res.json({ success: true, csrfToken: req.session.csrfToken });
    });
  });

  app.get("/api/auth/me", asyncRoute(async (req, res) => {
    if (!req.session.userId) return res.json({ success: true, user: null });
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    if (!user) {
      return req.session.destroy((error) => {
        if (error) return sendError(res, 500, "Could not clear the expired account session.");
        res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/" });
        res.json({ success: true, user: null });
      });
    }
    res.json({ success: true, user: publicUser(user) });
  }));

  app.post("/api/auth/signup", authLimiter, requireCsrf, asyncRoute(async (req, res) => {
    const { name, email, phone, password } = req.body || {};
    if (typeof name !== "string" || typeof email !== "string" || typeof phone !== "string" || typeof password !== "string") {
      return sendError(res, 400, "Full name, email, phone number, and password are required.");
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();
    const phoneDigits = normalizedPhone.replace(/\D/g, "");
    if (!normalizedName || normalizedName.length > 100) return sendError(res, 400, "Enter a name between 1 and 100 characters.");
    if (!isValidEmail(normalizedEmail)) return sendError(res, 400, "Enter a valid email address.");
    if (!/^\+?[0-9\s().-]{7,30}$/.test(normalizedPhone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      return sendError(res, 400, "Enter a valid phone number.");
    }
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
      return sendError(res, 400, "Use a password with at least 12 characters.");
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = {
      id: crypto.randomUUID(),
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone
    };
    try {
      await dbRun(
        "INSERT INTO users (id, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)",
        [user.id, user.name, user.email, user.phone, passwordHash]
      );
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT" || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return sendError(res, 409, "An account with this email already exists.");
      }
      throw error;
    }
    establishSession(req, res, user, "Account created successfully.");
  }));

  app.post("/api/auth/login", authLimiter, requireCsrf, asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string" || !isValidEmail(email.trim())) {
      return sendError(res, 400, "Enter a valid email address and password.");
    }
    if (Buffer.byteLength(password, "utf8") > 1024) {
      return sendError(res, 400, "The email or password is incorrect.");
    }

    const user = await dbGet(
      "SELECT id, name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE",
      [email.trim()]
    );
    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return sendError(res, 401, "The email or password is incorrect.");
    }
    establishSession(req, res, user, "Signed in successfully.");
  }));

  app.post("/api/auth/logout", requireCsrf, (req, res) => {
    req.session.destroy((error) => {
      if (error) return sendError(res, 500, "Could not sign out. Please try again.");
      res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/" });
      res.json({ success: true, message: "Signed out successfully." });
    });
  });

  app.get(["/", "/home.html"], (_req, res) => res.sendFile(path.join(__dirname, "home.html")));
  app.get("/img.jpeg", (_req, res) => res.sendFile(path.join(__dirname, "img.jpeg")));

  app.use("/api", (_req, res) => sendError(res, 404, "API route not found."));
  app.use((_req, res) => sendError(res, 404, "Page not found."));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("Request failed.", error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({
      success: false,
      message: status === 403 ? "This website origin is not allowed." : "The request could not be completed."
    });
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`Luma is listening on ${HOST}:${PORT}`);
  });

  function shutdown() {
    server.close(() => {
      db.close((error) => {
        if (error) {
          console.error("Could not close the database cleanly.", error);
          process.exitCode = 1;
        }
      });
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Could not start Luma.", error);
  db.close(() => process.exit(1));
});
