/**
 * Mental State Routes
 * Manages student wellness data, mood tracking, and journaling
 */

import express from 'express';
import { body } from 'express-validator';
import { protect,  authorize } from '../middleware/isAuthenticated.js';
// import { validate } from '../middleware/validationMiddleware.js';
import {
  updateMentalState,
  getMentalStateHistory,
  getMentalHealthInsights,
  getMentalHealthTrends,
  addJournalEntry
} from '../controllers/mentalStateController.js';

const router = express.Router();

// All mental state routes require authentication and student role
// router.use(protect, isStudent);

// --- Update mental state ---
router.post('/update', protect, authorize('student'),
  [
    body('stressLevel').optional().isIn(['low', 'medium', 'high', 'unknown']),
    body('motivationLevel').optional().isIn(['low', 'medium', 'high', 'unknown']),
    body('energyLevel').optional().isIn(['low', 'medium', 'high', 'unknown']),
    body('focusLevel').optional().isIn(['low', 'medium', 'high', 'unknown']),
    body('mood').optional().isIn(['happy', 'neutral', 'sad', 'anxious', 'tired', 'energetic']),
    body('notes').optional().isString().isLength({ max: 500 }),
    body('factors').optional().isArray(),
    body('sleepHours').optional().isFloat({ min: 0, max: 24 }),
    body('exerciseMinutes').optional().isInt({ min: 0, max: 1440 })
  ],
  // validate,
  updateMentalState
);

// --- Get mental state data ---
router.get('/history', protect, authorize('student'), getMentalStateHistory);
router.get('/insights', protect, authorize('student'), getMentalHealthInsights);
router.get('/trends', protect, authorize('student'), getMentalHealthTrends);

// --- Journal entry ---
router.post('/journal', protect, authorize('student'),
  [
    body('content').notEmpty().withMessage('Journal content is required').isLength({ max: 2000 }),
    body('type').optional().isIn(['general', 'grateful', 'challenge', 'reflection'])
  ],
  // validate,
  addJournalEntry
);

export default router;