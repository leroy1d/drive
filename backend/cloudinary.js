// drive-backend/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configuration directe (sans .env)
cloudinary.config({
  cloud_name: 'dvfiwy6nn',
  api_key: '773163377598981',
  api_secret: 'iM-hqRHJTHQ8p0dRFFg3Df_5e3M'
});

module.exports = cloudinary;