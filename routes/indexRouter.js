const express = require("express");
const indexRouter = express.Router();
const { getLanding } = require("../controllers/indexController");

indexRouter.get("/", getLanding);

module.exports = indexRouter;
