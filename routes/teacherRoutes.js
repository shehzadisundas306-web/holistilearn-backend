import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import { checkTeacherApproval } from '../middleware/checkTeacherApproval.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
    upsertTeacherProfile,
    getTeacherProfile,
    checkProfileStatus,
    updateSubjectsAndTopics,
    updateProfilePicture,
    updateTeacherSettings,
    getTeacherById,
    getAllTeachers,
    createClass,
    getTeacherClasses,
    getClassDetails,
    deleteClass,
    updateClass,
    regenerateClassCode,
    getTeacherOverview,
    getTeacherAnalytics
} from '../controllers/teacherController.js';

import {
    getTeacherDashboardData,
    getTeacherStats,
    getClassAnalytics
} from '../controllers/teacherDashboardController.js';

const router = express.Router();

// Configure multer for profile picture uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/profile-pictures';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `profile-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ==================== TEST ROUTE ====================
router.get('/test', protect, authorize('teacher'), checkTeacherApproval, (req, res) => {
  res.json({
    success: true,
    message: 'Test works',
    userId: req.userId,
    role: req.user.role
  });
});

// ==================== PUBLIC TEACHER DISCOVERY ====================
router.get('/discover', protect, getAllTeachers);
router.get('/discover/:teacherId', protect, getTeacherById);

// ==================== TEACHER PROFILE MANAGEMENT ====================
// Profile creation - does NOT require approval (teacher must create profile first)
router.put('/profile/subjects', protect, authorize('teacher'), updateSubjectsAndTopics);
router.post('/profile', protect, upsertTeacherProfile);
router.get('/profile', protect, getTeacherProfile);
router.get('/profile/status', protect, checkProfileStatus);
router.put('/profile/picture', protect, upload.single('profilePicture'), updateProfilePicture);
router.put('/profile/settings', protect, updateTeacherSettings);

// ==================== CLASS MANAGEMENT ====================
// These require teacher approval
router.post('/classes', protect, authorize('teacher'), checkTeacherApproval, createClass);
router.get('/classes', protect, authorize('teacher'), checkTeacherApproval, getTeacherClasses);
router.get('/classes/:classId', protect, authorize('teacher'), checkTeacherApproval, getClassDetails);
router.put('/classes/:classId', protect, authorize('teacher'), checkTeacherApproval, updateClass);
router.delete('/classes/:classId', protect, authorize('teacher'), checkTeacherApproval, deleteClass);
router.post('/classes/:classId/regenerate-code', protect, authorize('teacher'), checkTeacherApproval, regenerateClassCode);

// ==================== DASHBOARD & ANALYTICS ====================
// These require teacher approval
router.get('/dashboard/overview', protect, authorize('teacher'), checkTeacherApproval, getTeacherOverview);
router.get('/dashboard/analytics', protect, authorize('teacher'), checkTeacherApproval, getTeacherAnalytics);
router.get('/dashboard', protect, authorize('teacher'), checkTeacherApproval, getTeacherDashboardData);
router.get('/dashboard/stats', protect, authorize('teacher'), checkTeacherApproval, getTeacherStats);
router.get('/dashboard/class/:classId/analytics', protect, authorize('teacher'), checkTeacherApproval, getClassAnalytics);

export default router;