import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import {
    joinClassWithCode,
    getStudentClasses,
    getStudentClassDetails,
    leaveClass
} from '../controllers/studentController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ✅ Student-only routes (explicit role check)
router.post('/class/join', authorize('student'), joinClassWithCode);
router.get('/classes', authorize('student'), getStudentClasses);
router.get('/classes/:classId', authorize('student'), getStudentClassDetails);
router.delete('/classes/:classId/leave', authorize('student'), leaveClass);

export default router;