// backend/routes/activityRoutes.js
import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import {
  getRecentActivities,
  markActivityAsRead,
  deleteActivity,
  bulkDeleteActivities,
  clearAllActivities
} from '../controllers/activityController.js';

const router = express.Router();

// All activity routes require authentication
// router.use(protect, isStudent);

// Get recent activities
router.get('/recent', protect, authorize('student'), getRecentActivities);

// Bulk delete activities
router.delete('/bulk-delete', protect, authorize('student'), bulkDeleteActivities);

// Clear all activities
router.delete('/clear-all', protect, authorize('student'), clearAllActivities);

// Single activity operations
router.put('/:id/read', protect, authorize('student'), markActivityAsRead);
router.delete('/:id', protect, authorize('student'), deleteActivity);

export default router;