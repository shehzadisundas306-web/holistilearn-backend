/**
 * Dashboard Routes
 * Provides endpoints for student progress, insights, and performance summaries
 */

import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import {
  getDashboardData,
  getDashboardSummary,
  getWeeklyOverview,
  getTodayFocus,
  getInsights,
  getAchievements
} from '../controllers/dashboardController.js';

const router = express.Router();

// All dashboard routes require authentication and student role
// router.use(protect, isStudent);

/**
 * @route   GET /api/dashboard
 * @desc    Get comprehensive dashboard data
 */
router.get('/dashboard', protect, authorize('student'), getDashboardData);

/**
 * @route   GET /api/dashboard/summary
 * @desc    Get high-level summary (stats, level, total points)
 */
router.get('/dashboard/summary', protect, authorize('student'), getDashboardSummary);

/**
 * @route   GET /api/dashboard/weekly
 * @desc    Get study time and activity for the last 7 days
 */
router.get('/dashboard/weekly', protect, authorize('student'), getWeeklyOverview);

/**
 * @route   GET /api/dashboard/today
 * @desc    Get focus areas and tasks for the current day
 */
router.get('/dashboard/today', protect, authorize('student'), getTodayFocus);

/**
 * @route   GET /api/dashboard/insights
 * @desc    Get AI-driven learning insights and patterns
 */
router.get('/dashboard/insights', protect, authorize('student'), getInsights);

/**
 * @route   GET /api/dashboard/achievements
 * @desc    Get earned badges and milestones
 */
router.get('/dashboard/achievements', protect, authorize('student'), getAchievements);

export default router;