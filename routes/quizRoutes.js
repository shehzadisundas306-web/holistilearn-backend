// backend/routes/quizRoutes.js
import express from 'express';
import { body } from 'express-validator';
import { protect, authorize } from '../middleware/isAuthenticated.js';

import {
  getQuizzesByTopic,
  getQuizById,
  submitQuiz,
  getQuizResults,
  getQuizStats,
  generateQuiz,
  getQuizHistory,
  getQuizResultById,
  deleteQuizHistory,
  getTeacherQuizzes,
  createQuiz,
  updateQuiz,
  copyQuiz,
  deleteQuiz,
  getTeacherQuizResults,
  getStudentClassQuizzes,
  getStudentQuizById,
  getPersonalQuizzes
} from '../controllers/quizController.js';

const router = express.Router();

// ============================================
// 👨‍🏫 TEACHER ROUTES (TOP PRIORITY)
// ============================================

// Test endpoint
router.get('/teacher/test', protect, authorize('teacher'), (req, res) => {
  res.json({ success: true, userId: req.userId, role: req.user.role });
});

// Get all teacher's quizzes
router.get('/teacher', protect, authorize('teacher'), getTeacherQuizzes);

// Create a new quiz (teacher only)
router.post('/create', protect, authorize('teacher'), createQuiz);

// Update a quiz (teacher only)
router.put('/:id', protect, authorize('teacher'), updateQuiz);

// Copy a quiz (teacher only)
router.post('/:id/copy', protect, authorize('teacher'), copyQuiz);

// Delete a quiz (teacher only)
router.delete('/:id', protect, authorize('teacher'), deleteQuiz);

// Get quiz results for teacher view
router.get('/:id/results/teacher', protect, authorize('teacher'), getTeacherQuizResults);

// ============================================
// 🤖 SHARED ROUTES (STUDENT + TEACHER)
// ============================================

// Generate AI quiz (for both students and teachers)
router.post(
  '/generate',
  protect,
  authorize('student', 'teacher'),
  [
    body('topic').notEmpty().withMessage('Topic is required'),
    body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
    body('numQuestions').optional().isInt({ min: 5, max: 20 })
  ],
  generateQuiz
);

// ============================================
// 🎓 STUDENT ROUTES (ORDER MATTERS - SPECIFIC BEFORE DYNAMIC)
// ============================================

// 1. Student's personal practice quizzes (static route)
router.get('/student/personal', protect, authorize('student'), getPersonalQuizzes);

// 2. Get all quizzes for a specific class
router.get('/student/class/:classId/quizzes', protect, authorize('student'), getStudentClassQuizzes);

// 3. Student quiz history and stats (static routes - must come before /student/quiz/:quizId)
router.get('/history', protect, authorize('student'), getQuizHistory);
router.get('/stats', protect, authorize('student'), getQuizStats);
router.get('/result/:quizId', protect, authorize('student'), getQuizResultById);
router.delete('/history/:quizId', protect, authorize('student'), deleteQuizHistory);
router.get('/topic/:topicId', protect, authorize('student'), getQuizzesByTopic);

// 4. Dynamic quiz routes for students (MUST BE AFTER STATIC ROUTES)
router.get('/student/quiz/:quizId', protect, authorize('student'), getStudentQuizById);
router.post('/student/quiz/:quizId/submit', protect, authorize('student'), submitQuiz);

// ============================================
// 🎓 LEGACY / DYNAMIC STUDENT ROUTES (MUST BE ABSOLUTE LAST)
// ============================================

// Get quiz by ID (legacy - for both students and teachers)
router.get('/:id', protect, authorize('student', 'teacher'), getQuizById);

// Get quiz results for a specific quiz (legacy)
router.get('/:id/results', protect, authorize('student'), getQuizResults);

// Submit quiz answers (legacy endpoint - kept for compatibility)
router.post(
  '/:id/submit',
  protect,
  authorize('student'),
  [
    body('answers').isArray().withMessage('Answers must be an array'),
    body('timeSpent').optional().isInt({ min: 0 })
  ],
  submitQuiz
);

export default router;