/**
 * Topic Routes
 * Handles topic discovery, search, and progress tracking
 */

import express from 'express';
import { query, body, param } from 'express-validator';
import { protect,  authorize } from '../middleware/isAuthenticated.js';
// import { validate } from '../middleware/validationMiddleware.js';
import {
  getTopics,
  getTopicById,
  startTopic,
  updateTopicProgress,
  searchTopics,
  getRecommendedTopics,
  getCategories,
  getTopicStats,
  getUserStats,
  discoverTopics,
  startAITopic
} from '../controllers/topicController.js';
import Topic from '../models/Topic.js';

const router = express.Router();

// All topic routes require authentication and student role
router.use(protect);

// --- Topic listing and search ---
router.get('/', authorize('student'),
  [
    query('category').optional(),
    query('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
    query('search').optional().isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('sortBy').optional().isIn(['popularity', 'newest', 'difficulty', 'duration'])
  ],
  // validate,
  getTopics
);

router.get('/search', authorize('student'),
  [
    query('q').notEmpty().withMessage('Search query is required'),
    query('category').optional(),
    query('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 })
  ],
  // validate,
  searchTopics
);

// backend/routes/topicRoutes.js - Add this new route

// In your routes file, add:
router.post('/discover',  authorize('student'),
  [
    body('query').notEmpty().withMessage('Search query is required'),
    body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
    body('goal').optional().isString()
  ],
  discoverTopics
);
router.post('/ai/start', authorize('student'), startAITopic);

router.get('/categories', authorize('student'), getCategories);
router.get('/recommended', authorize('student'), getRecommendedTopics);
router.get('/stats', authorize('student'), getTopicStats);

// --- Single topic operations ---
router.get('/:id', authorize('student'),
  param('id').isMongoId().withMessage('Invalid topic ID'),
  // validate,
  getTopicById
);

router.post('/:id/start', authorize('student'),
  param('id').isMongoId().withMessage('Invalid topic ID'),
  // validate,
  startTopic
);

router.put('/:id/progress', authorize('student'),
  [
    param('id').isMongoId().withMessage('Invalid topic ID'),
    body('progress').optional().isInt({ min: 0, max: 100 }),
    body('lessonId').optional().isString(),
    body('timeSpent').optional().isInt({ min: 0 })
  ],
  // validate,
  updateTopicProgress
);
// In topicRoutes.js, add:
router.get('/stats/user', authorize('student'), getUserStats);
/**
 * TEMPORARY - Manual Topic Creation
 * Used for administrative or seeding purposes
 */
router.post('/create', protect, authorize('student'), async (req, res) => {
  try {
    console.log('='.repeat(50));
    console.log('📝 CREATE TOPIC REQUEST RECEIVED');
    console.log('='.repeat(50));
    
    const { title, description, category, difficulty, duration } = req.body;
    
    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!description) missingFields.push('description');
    if (!category) missingFields.push('category');
    if (!difficulty) missingFields.push('difficulty');
    if (!duration) missingFields.push('duration');
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        missingFields
      });
    }
    
    // Create content with explicit fields
    const content = {
      overview: `This comprehensive guide to ${title} will teach you everything you need to know. ${description}`,
      objectives: [
        `Understand the core concepts of ${title}`,
        `Build real-world projects using ${title}`,
        `Master best practices and common patterns`
      ],
      sections: [
        {
          title: `Introduction to ${title}`,
          content: `Fundamental concepts and prerequisites.`,
          order: 1,
          duration: Math.floor(duration / 3) || 30
        },
        {
          title: `${title} Core Concepts`,
          content: `Main features and functionality.`,
          order: 2,
          duration: Math.floor(duration / 3) || 30
        },
        {
          title: `Advanced ${title} Topics`,
          content: `Advanced concepts and real-world applications.`,
          order: 3,
          duration: duration - (2 * (Math.floor(duration / 3) || 30)) || 30
        }
      ],
      summary: `${title} is an essential skill for modern developers.`,
      keyTakeaways: [`Master ${title} fundamentals`, `Apply best practices`]
    };
    
    const topic = new Topic({
      title,
      description,
      category,
      difficulty,
      duration,
      content,
      tags: [category.toLowerCase(), difficulty, title.toLowerCase()],
      skills: [title, `${title} Development`],
      createdBy: req.user.id,
      isPublished: true
    });
    
    const validationError = topic.validateSync();
    if (validationError) {
      const errors = {};
      Object.keys(validationError.errors).forEach(key => {
        errors[key] = validationError.errors[key].message;
      });
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }
    
    const savedTopic = await topic.save();
    
    res.status(201).json({
      success: true,
      message: 'Topic created successfully',
      topic: {
        id: savedTopic._id,
        title: savedTopic.title,
        category: savedTopic.category,
        difficulty: savedTopic.difficulty
      }
    });
    
  } catch (error) {
    console.error('❌ ERROR CREATING TOPIC:', error.message);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A topic with this title already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating topic',
      error: error.message
    });
  }
});

export default router;