const express = require("express");
const axios = require("axios");
const User = require("../models/user"); // Import User model
const pgSync = require("../services/pgSync"); // Import PostgreSQL sync
const router = express.Router();

const {
  COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET,
  COGNITO_DOMAIN,
  COGNITO_REDIRECT_URI,
  COGNITO_LOGOUT_URI,
} = process.env;

// 🔹 Signup route — Redirect to Cognito Hosted UI signup page
router.get("/signup", (req, res) => {
  // Use /signup endpoint to show signup form directly
  const signupUrl = `${COGNITO_DOMAIN}/signup?client_id=${COGNITO_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    COGNITO_REDIRECT_URI
  )}&response_type=code&scope=email+openid+profile`;
  console.log("🔍 Cognito Signup URL:", signupUrl);
  res.redirect(signupUrl);
});

// 🔹 Login route — Redirect user to Cognito Hosted UI
router.get("/login", (req, res) => {
  // Debug: Log the configuration
  console.log("\n🔍 Cognito Login Configuration:");
  console.log("COGNITO_DOMAIN:", COGNITO_DOMAIN);
  console.log("COGNITO_CLIENT_ID:", COGNITO_CLIENT_ID);
  console.log("COGNITO_REDIRECT_URI:", COGNITO_REDIRECT_URI);

  // Try using /oauth2/authorize endpoint instead of /login
  const loginUrl = `${COGNITO_DOMAIN}/oauth2/authorize?client_id=${COGNITO_CLIENT_ID}&response_type=code&scope=email+openid+profile&redirect_uri=${encodeURIComponent(
    COGNITO_REDIRECT_URI
  )}`;
  console.log("Login URL:", loginUrl);
  console.log("");

  res.redirect(loginUrl);
});

// 🔹 Callback route — Handle Cognito response
router.get("/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");

  try {
    const tokenUrl = `${COGNITO_DOMAIN}/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: COGNITO_CLIENT_ID,
      code,
      redirect_uri: COGNITO_REDIRECT_URI,
    });

    const authHeader = Buffer.from(
      `${COGNITO_CLIENT_ID}:${COGNITO_CLIENT_SECRET}`
    ).toString("base64");

    const tokenResponse = await axios.post(tokenUrl, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
      },
    });

    const tokens = tokenResponse.data;

    // Decode ID token to get user info (JWT payload)
    const idTokenPayload = JSON.parse(
      Buffer.from(tokens.id_token.split(".")[1], "base64").toString()
    );

    // Check if user exists in MongoDB (using Cognito sub as _id)
    let user = await User.findById(idTokenPayload.sub);

    if (!user) {
      // First time login - create new user in MongoDB with basic info from Cognito
      // Strip +91 from phone number if present (Cognito stores E.164 format)
      const phoneNumber = idTokenPayload.phone_number || "";
      const cleanPhone = phoneNumber.replace(/^\+91/, ""); // Remove +91 prefix

      user = new User({
        _id: idTokenPayload.sub, // Use Cognito sub as MongoDB _id
        firstName:
          idTokenPayload.given_name || idTokenPayload.email.split("@")[0],
        lastName: idTokenPayload.family_name || "",
        email: idTokenPayload.email,
        phone: cleanPhone, // Store only 10 digits in database
        password: "COGNITO_MANAGED", // Placeholder - password managed by Cognito
        upiLink: "", // Will be filled later by user in edit profile
        // profilePicUrl and profilePicKey will be added when user uploads via edit profile
      });
      await user.save();
      console.log("✅ New Cognito user created in MongoDB:", user.email);

      // Sync new user to PostgreSQL
      if (process.env.DB_HOST || process.env.DB_USER || process.env.DB_NAME) {
        pgSync
          .syncUser(user)
          .catch((e) =>
            console.warn("PostgreSQL sync failed for Cognito user:", e.message)
          );
      }
    }

    // Store complete user info in session (including custom fields from DB)
    req.session.user = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      profilePicUrl: user.profilePicUrl,
      profilePicKey: user.profilePicKey,
      upiLink: user.upiLink,
    };
    req.session.tokens = tokens;
    req.session.isLoggedIn = true;

    // Redirect to groups page after successful Cognito login
    res.redirect("/user/groups");
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Authentication failed");
  }
});

// 🔹 Logout route
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destroy error:", err);
    }
    // Cognito logout redirects to COGNITO_LOGOUT_URI (index page)
    const logoutUrl = `${COGNITO_DOMAIN}/logout?client_id=${COGNITO_CLIENT_ID}&logout_uri=${encodeURIComponent(
      COGNITO_LOGOUT_URI
    )}`;
    console.log("🔍 Logout URL:", logoutUrl);
    res.redirect(logoutUrl);
  });
});

module.exports = router;
