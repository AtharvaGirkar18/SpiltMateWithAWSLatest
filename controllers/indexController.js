const getLanding = (req, res, next) => {
  if (req.session.user && req.session.isLoggedIn) {
    return res.redirect("/user/groups");
  }
  res.render("index", {
    pageTitle: "Welcome to SplitMate",
    isLoggedIn: false,
  });
};

exports.getLanding = getLanding;
