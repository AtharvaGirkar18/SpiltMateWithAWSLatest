const express = require("express");
const userRouter = express.Router();
const { upload } = require("../uploads3");
const userController = require("../controllers/userController");

userRouter.get("/groups", userController.getGroups);
userRouter.get("/create-group", userController.showCreateGroup);
userRouter.post("/create-group", userController.createGroup);
userRouter.get("/search", userController.liveUserSearch);
userRouter.get("/groups/:groupId", userController.showGroupDetail);
userRouter.post(
  "/groups/:groupId/toggle-status",
  userController.toggleGroupStatus
);
userRouter.get("/groups/:groupId/you-are-owed", userController.showYouAreOwed);
userRouter.get("/groups/:groupId/you-owe", userController.showYouOwe);
userRouter.get("/groups/:groupId/edit", userController.showEditGroup);
userRouter.post("/groups/:groupId/edit", userController.editGroup);
userRouter.get("/groups/:groupId/add-expense", userController.showAddExpense);
userRouter.post("/groups/:groupId/add-expense", userController.addExpense);
userRouter.get("/groups/:groupId/pay/:toUserId", userController.showPayForm);
userRouter.post(
  "/groups/:groupId/pay/:toUserId",
  userController.submitPaymentRequest
);
userRouter.post(
  "/groups/:groupId/you-are-owed/approve",
  userController.approvePending
);
userRouter.post(
  "/groups/:groupId/you-are-owed/disapprove",
  userController.disapprovePending
);

// Profile management routes
userRouter.get("/profile", userController.showEditProfile);
// Use S3 upload middleware for profile picture on the main profile POST
userRouter.post(
  "/profile",
  upload.single("profilePicture"),
  userController.updateProfile
);
userRouter.post("/profile/remove-picture", userController.removeProfilePicture);

// NEW route for profile image upload to S3
// optional separate upload endpoint (kept for backward compat) — use same field name
userRouter.post(
  "/profile/upload-picture",
  upload.single("profilePicture"),
  userController.uploadProfilePicture
);

module.exports = userRouter;
