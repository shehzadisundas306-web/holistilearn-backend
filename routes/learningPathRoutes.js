// backend/routes/learningPathRoutes.js
import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import {
  getCurrentLearningPath,
  getCurrentPath,  // ✅ ADD THIS alias
  updateLearningPathProgress,
  getCompletedPaths,
  switchToPath,
  archiveCurrentPath,
  completeTopic,
  getAllPaths,
  resumePath,
  pauseCurrentPath,
  generateLearningPath,
  deletePath,
  getMilestoneForReview,
  getUserStats  // ✅ ADD THIS
} from '../controllers/learningPathController.js';

const router = express.Router();

// router.use(protect, isStudent);

// Current path routes
router.get('/current', protect, authorize('student'), getCurrentLearningPath);
router.get('/current-path', protect, authorize('student'), getCurrentPath);  // ✅ ADD alias route
router.put('/progress', protect, authorize('student'), updateLearningPathProgress);
router.post('/complete-topic', protect, authorize('student'), completeTopic);

// Path management
router.post('/generate', protect, authorize('student'), generateLearningPath);
router.post('/pause', protect, authorize('student'), pauseCurrentPath);
router.post('/resume', protect, authorize('student'), resumePath);
router.post('/archive', protect, authorize('student'), archiveCurrentPath);

// Path listing
router.get('/all', protect, authorize('student'), getAllPaths);
router.get('/completed', protect, authorize('student'), getCompletedPaths);
router.post('/switch/:pathId', protect, authorize('student'), switchToPath);
router.delete('/delete/:pathId', protect, authorize('student'), deletePath);
router.get('/milestone/:milestoneId', protect, authorize('student'), getMilestoneForReview);

// Stats routes
router.get('/stats', protect, authorize('student'), getUserStats);  // ✅ FIXED: Use getUserStats, not getTopicStats

export default router;