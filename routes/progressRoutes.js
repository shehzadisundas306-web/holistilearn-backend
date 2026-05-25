/**
 * Progress Routes
 * Handles student learning metrics, streaks, and activity history
 */

import express from 'express';
import { query } from 'express-validator';
import { protect, authorize } from '../middleware/isAuthenticated.js';
// import { validate } from '../middleware/validationMiddleware.js';
import {
  getProgressOverview,
  getLearningStreak,
  getWeeklyActivity,
  getMonthlyProgress,
  getAchievements,
  getLearningInsights,
  getProgressSummary
} from '../controllers/progressController.js';

const router = express.Router();

// All progress routes require authentication and student role
// router.use(protect, isStudent);

// --- Aggregated Progress Summary (NEW) ---
router.get('/summary', protect, authorize('student'), getProgressSummary);
// --- Progress Overview ---
router.get('/overview', protect, authorize('student'), getProgressOverview);

// --- Learning Streak ---
router.get('/streak', protect, authorize('student'), getLearningStreak);

// --- Weekly Activity ---
router.get('/weekly', protect, authorize('student'), getWeeklyActivity);
// backend/routes/progressRoutes.js
// Add this route


// --- Monthly Progress ---
router.get('/monthly', protect, authorize('student'),
  [
    query('year').optional().isInt({ min: 2020, max: 2100 }),
    query('month').optional().isInt({ min: 1, max: 12 })
  ],
  // validate,
  getMonthlyProgress
);

// --- Achievements and Insights ---
router.get('/achievements', protect, authorize('student'), getAchievements);
router.get('/insights', protect, authorize('student'), getLearningInsights);

export default router;