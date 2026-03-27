const multer = require('multer');

// Resume PDFs are parsed in memory and never written to disk.
exports.upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF allowed')),
});
