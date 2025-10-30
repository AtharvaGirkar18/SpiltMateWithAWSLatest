const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  _id: {
    type: String, // Allow string _id for Cognito users (UUID format)
    required: true,
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  profilePicUrl: {
    type: String, // optional URL to profile photo stored in S3 or elsewhere
  },
  profilePicKey: {
    type: String, // optional S3 object key for the profile photo (e.g. 'profile-images/uuid.jpg')
  },
  phone: {
    type: String,
    required: true, // Required for notifications
    trim: true,
  },
  upiLink: {
    type: String,
    required: false, // Optional - users can add during profile edit
    trim: true,
    default: "", // Default to empty string
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);
