// backend/routes/assignmentRoutes.js
import express from 'express';
import { protect } from '../middleware/isAuthenticated.js';
import {
  createAssignment,
  getClassAssignments,
  getAssignmentSubmissions,
  gradeSubmission,
  deleteAssignment,
  getStudentAssignments,
  submitAssignment,
  getStudentSubmission
} from '../controllers/assignmentController.js';

const router = express.Router();

// ==================== TEACHER ROUTES ====================
router.post('/', protect, createAssignment);
router.get('/class/:classId', protect, getClassAssignments);
router.get('/:assignmentId/submissions', protect, getAssignmentSubmissions);
router.put('/submissions/:submissionId/grade', protect, gradeSubmission);
router.delete('/:assignmentId', protect, deleteAssignment);

// ==================== STUDENT ROUTES ====================
router.get('/student/class/:classId', protect, getStudentAssignments);
router.post('/:assignmentId/submit', protect, submitAssignment);
router.get('/:assignmentId/submission', protect, getStudentSubmission);

export default router;