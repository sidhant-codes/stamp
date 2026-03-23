const router = require('express').Router();
const { requireUser } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { register, login, me, forgot, reset, verify, resendVerification, deleteMe } = require('../controllers/user');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot', authLimiter, forgot);
router.post('/reset', authLimiter, reset);
router.post('/verify', authLimiter, verify);
router.post('/resend-verification', requireUser, authLimiter, resendVerification);
router.get('/me', requireUser, me);
router.delete('/me', requireUser, authLimiter, deleteMe);

module.exports = router;
