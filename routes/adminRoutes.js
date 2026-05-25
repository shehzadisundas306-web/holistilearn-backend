import express from 'express';
import { isAuthenticated, authorize } from '../middleware/isAuthenticated.js';
import {
    getDashboardStats,
    getAllUsers,
    getUserDetails,
    updateUserStatus,
    deleteUser,
    getPendingTeachers,
    approveTeacher,
    rejectTeacher,
    getAllClasses,
    deleteClass,
    getAllQuizzes,
    deleteQuiz,
    getPlatformAnalytics,
    updateSystemSettings,
    getSystemSettings,
    getActivityLogs,
    getTeacherStats,
    getStudentStats,
    updateAdminProfile,  // ✅ Add this import
    getAllTeachersForAdmin
} from '../controllers/adminController.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(isAuthenticated);
router.use(authorize('admin'));

// ==================== DASHBOARD ====================
router.get('/dashboard/stats', getDashboardStats);
router.get('/analytics', getPlatformAnalytics);

// ==================== USER MANAGEMENT ====================
router.get('/users', getAllUsers);
router.get('/users/:userId', getUserDetails);
router.put('/users/:userId/status', updateUserStatus);
router.delete('/users/:userId', deleteUser);

// ==================== TEACHER MANAGEMENT ====================
router.get('/teachers/pending', getPendingTeachers);
router.put('/teachers/:teacherId/approve', approveTeacher);
router.put('/teachers/:teacherId/reject', rejectTeacher);
router.get('/teachers/stats', getTeacherStats);

// ==================== STUDENT MANAGEMENT ====================
router.get('/students/stats', getStudentStats);

// ==================== CLASS MANAGEMENT ====================
router.get('/classes', getAllClasses);
router.delete('/classes/:classId', deleteClass);

// ==================== QUIZ MANAGEMENT ====================
router.get('/quizzes', getAllQuizzes);
router.delete('/quizzes/:quizId', deleteQuiz);

// ==================== SYSTEM SETTINGS ====================
router.get('/settings', getSystemSettings);
router.put('/settings', updateSystemSettings);

// ==================== ACTIVITY LOGS ====================
router.get('/activities', getActivityLogs);

// ✅ ADD THIS ROUTE - Admin Profile Update
router.put('/profile/update', updateAdminProfile);

// backend/routes/adminRoutes.js

// Add this route
router.get('/teachers/all', getAllTeachersForAdmin);

export default router;