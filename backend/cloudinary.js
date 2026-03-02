// drive-backend/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configuration directe (sans .env)
cloudinary.config({
  cloud_name: 'du4bwdvlf',
  api_key: '888156399558126',
  api_secret: 'dSgvxSI1X1KK0fvZtlsauLjoHYQ'
});

module.exports = cloudinary;
