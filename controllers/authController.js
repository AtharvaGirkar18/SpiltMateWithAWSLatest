const { check, validationResult } = require("express-validator");
const User = require("../models/user");
const bcrypt = require("bcryptjs");
const pgSync = require("../services/pgSync");

const getLogin = (req, res, next) => {
  res.render("auth/login", {
    pageTitle: "Login",
    currentPage: "Login",
    isLoggedIn: false,
    errors: [],
    oldInput: {
      email: "",
    },
    user: {},
  });
};

const postLogin = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(422).render("auth/login", {
        pageTitle: "Login",
        currentPage: "Login",
        isLoggedIn: false,
        errors: ["Invalid email or password"],
        oldInput: { email },
        user: {},
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(422).render("auth/login", {
        pageTitle: "Login",
        currentPage: "Login",
        isLoggedIn: false,
        errors: ["Invalid email or password"],
        oldInput: { email },
        user: {},
      });
    }

    req.session.isLoggedIn = true;
    req.session.user = user;
    await req.session.save();
    res.redirect("/");
  } catch (err) {
    return res.status(422).render("auth/login", {
      pageTitle: "Login",
      currentPage: "Login",
      isLoggedIn: false,
      errors: ["An error occurred during login"],
      oldInput: { email },
      user: {},
    });
  }
};

const postLogout = (req, res, next) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
};

const getSignup = (req, res, next) => {
  res.render("auth/signup", {
    pageTitle: "Signup",
    currentPage: "Signup",
    isLoggedIn: false,
    errors: [],
    oldInput: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      upiLink: "",
      password: "",
    },
    user: {},
  });
};

const postSignup = [
  check("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name is required")
    .isLength({ min: 2 })
    .withMessage("First name must be at least 2 characters long")
    .matches(/^[a-zA-Z]+$/)
    .withMessage("First name must contain only letters"),

  check("lastName")
    .optional({ checkFalsy: true })
    .matches(/^[a-zA-Z]*$/)
    .withMessage("Last name must contain only letters"),

  check("email")
    .isEmail()
    .withMessage("Please enter a valid email address")
    .normalizeEmail(),

  check("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^[6-9]\d{9}$/)
    .withMessage(
      "Please enter a valid 10-digit Indian mobile number (e.g., 9876543210)"
    ),

  check("upiLink")
    .trim()
    .notEmpty()
    .withMessage("UPI ID/Link is required")
    .custom((value) => {
      if (!value.match(/^upi:\/\/|^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/)) {
        throw new Error(
          "Please enter a valid UPI ID (e.g., yourname@upi) or UPI link (e.g., upi://pay?pa=yourname@upi)"
        );
      }
      return true;
    }),

  check("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)"
    ),

  check("confirmPassword")
    .trim()
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),

  check("terms").custom((value, { req }) => {
    if (!value) {
      throw new Error("You must accept the terms and conditions");
    }
    return true;
  }),

  (req, res, next) => {
    const { firstName, lastName, email, phone, upiLink, password, userType } =
      req.body;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(422).render("auth/signup", {
        pageTitle: "Signup",
        currentPage: "Signup",
        isLoggedIn: false,
        errors: errors.array().map((err) => err.msg),
        oldInput: {
          firstName,
          lastName,
          email,
          phone,
          upiLink,
          password,
          userType,
        },
        user: {},
      });
    }

    bcrypt
      .hash(password, 12)
      .then((hashedPassword) => {
        const user = new User({
          firstName,
          lastName,
          email,
          phone, // Now required
          password: hashedPassword,
          upiLink, // Already required
          userType,
        });
        return user.save();
      })
      .then((savedUser) => {
        // Async attempt to sync with Postgres — do not block the response flow
        if (
          process.env.DB_HOST ||
          process.env.DB_USER ||
          process.env.DB_NAME ||
          process.env.PG_HOST ||
          process.env.PG_USER ||
          process.env.PGDATABASE
        ) {
          pgSync
            .syncUser(savedUser)
            .then((ok) => {
              if (!ok)
                console.warn(
                  "User saved in MongoDB but Postgres sync reported failure"
                );
            })
            .catch((e) =>
              console.warn(
                "Pg sync error for user:",
                e && e.message ? e.message : e
              )
            );
        }

        console.log("User created successfully");
        res.redirect("/auth/login");
      })
      .catch((err) => {
        return res.status(422).render("auth/signup", {
          pageTitle: "Signup",
          currentPage: "Signup",
          isLoggedIn: false,
          errors: [err.message],
          oldInput: { firstName, lastName, email, phone, upiLink, userType },
          user: {},
        });
      });
  },
];

exports.getLogin = getLogin;
exports.postLogin = postLogin;
exports.postLogout = postLogout;
exports.getSignup = getSignup;
exports.postSignup = postSignup;
