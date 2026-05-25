import express from 'express';
import { body } from 'express-validator';
import { protect, authorize } from '../middleware/isAuthenticated.js';

import {
  generateAINotes,
  generateAIQuiz,
  generateLearningPath,
  recommendTopics,
  getMentalHealthTip,
  downloadNotes,
  getNotesHistory,
  getNoteById,
  deleteNote,
  archiveNote,
  generateTeacherQuiz
} from '../controllers/aiController.js';

const router = express.Router();

// ============================================
// 🤖 QUIZ GENERATION
// ============================================

// 🎓 Student AI Quiz
router.post(
  '/generate-quiz',
  protect,
  authorize('student'),
  [
    body('topic').notEmpty().withMessage('Topic is required'),
    body('difficulty')
      .optional()
      .isIn(['beginner', 'intermediate', 'advanced']),
    body('numQuestions')
      .optional()
      .isInt({ min: 5, max: 20 }),
    body('includeExplanations')
      .optional()
      .isBoolean()
  ],
  generateAIQuiz
);

// 👨‍🏫 Teacher AI Quiz
router.post(
  '/teacher/generate-quiz',
  protect,
  authorize('teacher'),
  generateTeacherQuiz
);


// ============================================
// 🎓 STUDENT FEATURES
// ============================================

router.post(
  '/generate-notes',
  protect,
  authorize('student'),
  [body('topic').notEmpty()],
  generateAINotes
);

router.get('/notes/history', protect, authorize('student'), getNotesHistory);

router.get('/notes/:noteId', protect, authorize('student'), getNoteById);

router.delete('/notes/:noteId', protect, authorize('student'), deleteNote);

router.put('/notes/:noteId/archive', protect, authorize('student'), archiveNote);

router.post(
  '/generate-learning-path',
  protect,
  authorize('student'),
  [body('goal').notEmpty()],
  generateLearningPath
);

router.post('/recommend-topics', protect, authorize('student'), recommendTopics);

router.get('/mental-health-tip', protect, authorize('student'), getMentalHealthTip);

router.get('/download/:noteId/:format', protect, authorize('student'), downloadNotes);

export default router;