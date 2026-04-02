const router = require('express').Router();
const { requireUser, requireAdmin } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');
const { analyzeInput, generateInput } = require('../middleware/validate');
const { requireQuota } = require('../middleware/quota');
const { requireVerified } = require('../middleware/verified');
const ctrl = require('../controllers/resume');

router.use(requireUser, userLimiter);
router.post('/analyze', requireVerified, upload.single('resume'), analyzeInput, requireQuota, ctrl.analyze);
router.post('/generate', requireVerified, generateInput, requireQuota, ctrl.generate);
router.post('/improve/:id', requireVerified, requireQuota, ctrl.improve);
router.post('/export', ctrl.exportResume);
router.get('/history', ctrl.myHistory);
router.delete('/history/:id', ctrl.deleteAnalysis);
router.get('/generated', ctrl.myGenerated);
router.put('/generated/:id', ctrl.updateGenerated);
router.delete('/generated/:id', ctrl.deleteGenerated);
router.get('/all', requireAdmin, ctrl.allHistory);

module.exports = router;
