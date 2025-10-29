const { S3Client } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");

// Create an AWS SDK v3 S3Client instance. multer-s3 v3 expects a v3 client.
// Use the default credential provider chain so credentials can come from
// environment variables, shared credentials file (~/.aws/credentials),
// or instance/role metadata — this avoids hardcoding credentials here.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET,
    key: (req, file, cb) => {
      cb(null, `profile-images/${Date.now()}_${file.originalname}`);
    },
  }),
});

module.exports = {
  upload,
  s3,
  bucketName: process.env.AWS_S3_BUCKET,
};
