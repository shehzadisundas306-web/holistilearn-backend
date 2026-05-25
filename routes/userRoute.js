import express from 'express' 
import { changePassword, forgotPassword, getAllUsers, getMe, getTeachers, getTeachersPaginated, getTeacherSubjects, getUserById, login, logout, registerUser, searchUsers, updateRole, verification, verifyOtp } from '../controllers/userController.js';
import { isAuthenticated, protect } from '../middleware/isAuthenticated.js';
import { userSchema, validateUser } from '../validators/userValidate.js';
import passport from 'passport';
import jwt from 'jsonwebtoken'

const router = express.Router();

// User routes
router.get('/me', isAuthenticated, getMe);
router.post('/register', validateUser(userSchema), registerUser)
router.post('/verify', verification)
router.post('/login', login)
router.post('/logout', isAuthenticated, logout)
router.post('/forgotPassword', forgotPassword)
router.post('/verifyOtp/:email', verifyOtp)
router.post('/changePassword/:email', changePassword)
router.put('/update-role', isAuthenticated, updateRole)

// Admin routes
router.get('/all', isAuthenticated, getAllUsers);
router.get('/search', searchUsers);



// Google Auth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));

router.get('/auth/google/callback', 
  passport.authenticate('google', { session: false }), 
  (req, res) => {
    const token = jwt.sign({ id: req.user._id }, process.env.SECRET_KEY, { expiresIn: '10d' });
    res.redirect(`http://localhost:3000/google-success?token=${token}`);
  }
);

// Teacher discovery routes (keep these - they're for students finding teachers)
router.get('/teachers/search', isAuthenticated, getTeachersPaginated);
router.get('/teachers/subjects', isAuthenticated, getTeacherSubjects);
router.get('/teachers', isAuthenticated, getTeachers);

router.get('/:userId', getUserById);

export default router;