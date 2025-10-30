require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongodb-session")(session);
const bodyParser = require("body-parser");
const { s3, bucketName } = require("./uploads3");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const pgClient = require("./services/pgClient");

// Import routers
const indexRouter = require("./routes/indexRouter");
const authRouter = require("./routes/authRouter");
const userRouter = require("./routes/userRouter");
const authCognito = require("./routes/authCognito");
// Add your storeRouter, hostRouter, pageNotFound as needed

const app = express();
const rootDir = path.dirname(require.main.filename);

// Your MongoDB URI from environment variables
const DB_URL = process.env.MONGODB_URI || "mongodb://localhost:27017/splitmate";

// Create MongoDB session store
const store = new MongoDBStore({
  uri: DB_URL,
  collection: "sessions",
  connectionOptions: {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000,
  },
});

// Catch session store errors
store.on("error", function (error) {
  console.error("❌ Session store error:", error.message);
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware to log requests
app.use((req, res, next) => {
  console.log(req.url, req.method);
  next();
});

// Parsing middleware
app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware with MongoDB store
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_secret_for_development",
    resave: false,
    saveUninitialized: true,
    store: store,
  })
);

// Attach isLoggedIn flag for templates
app.use((req, res, next) => {
  req.isLoggedIn = req.session.isLoggedIn;
  res.locals.user = req.session.user;
  next();
});

// Generate a short-lived presigned URL for the user's profile picture (if stored on S3)
// This keeps objects private in S3 while still allowing the browser to fetch them.
app.use(async (req, res, next) => {
  res.locals.signedProfilePicUrl = null;
  try {
    const user = req.session.user;
    if (user && user.profilePicUrl && bucketName) {
      const match = user.profilePicUrl.match(/profile-images\/.+/);
      if (match) {
        const Key = match[0];
        const cmd = new GetObjectCommand({ Bucket: bucketName, Key });
        // short expiry (60s) is enough for page load
        res.locals.signedProfilePicUrl = await getSignedUrl(s3, cmd, {
          expiresIn: 60,
        });
      }
    }
  } catch (err) {
    console.warn(
      "Failed to create presigned URL:",
      err && err.message ? err.message : err
    );
  }
  next();
});

// Static file serving
app.use(express.static(path.join(rootDir, "public")));
app.use("/uploads", express.static(path.join(rootDir, "uploads")));
app.use("/user/uploads", express.static(path.join(rootDir, "uploads")));
app.use("/host/uploads", express.static(path.join(rootDir, "uploads")));

// Handle favicon requests
app.get("/favicon.ico", (req, res) => res.status(204).end());

// Routes
app.use("/", indexRouter);
// app.use("/auth", authRouter); // Old MongoDB-based auth (disabled for Cognito)
app.use("/auth", authCognito); // AWS Cognito auth
app.use("/user", (req, res, next) => {
  if (req.isLoggedIn) {
    next();
  } else {
    res.redirect("/auth/login");
  }
});
app.use("/user", userRouter);

// Add storeRouter, hostRouter, and other routers similarly and protect routes where needed

// 404 page handler middleware (adjust to your 404 rendering page)
app.use((req, res) => {
  res
    .status(404)
    .render("partials/404", { pageTitle: "Page Not Found - SplitMate" });
});

const PORT = process.env.PORT || 3000;

mongoose
  .connect(DB_URL)
  .then(async () => {
    console.log("Connected to MongoDB");
    try {
      await pgClient.initPg();
    } catch (e) {
      console.warn(
        "Postgres initialization failed (continuing with Mongo only):",
        e && e.message ? e.message : e
      );
    }

    app.listen(PORT, () => {
      console.log(`SplitMate app running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
  });
