  // backend/controllers/topicController.js
import Topic from '../models/Topic.js';
import Progress from '../models/StudentProgress.js';
import Activity from '../models/Activity.js';
import LearningPath from '../models/LearningPath.js';
import RecommendedTopics from '../models/RecommendedTopics.js';
import MentalState from '../models/MentalState.js'
import QuizHistory from '../models/QuizHistory.js';
import aiService from '../services/aiService.js';
import constants from '../config/constants.js';
import { triggerProgressUpdate, emitIncrementalUpdate } from '../config/socket.js';

// ============= HELPER FUNCTIONS (DEFINED AT TOP) =============

// Helper function to parse "X hours" to minutes
function parseDurationToMinutes(durationStr) {
  if (!durationStr) return 180;
  if (typeof durationStr === 'number') return durationStr;
  
  const durationStrLower = String(durationStr).toLowerCase();
  
  const hours = durationStrLower.match(/(\d+)\s*hours?/);
  if (hours) return parseInt(hours[1]) * 60;
  
  const mins = durationStrLower.match(/(\d+)\s*mins?/);
  if (mins) return parseInt(mins[1]);
  
  const numbers = durationStrLower.match(/\d+/);
  if (numbers) return parseInt(numbers[0]) * 60;
  
  return 180;
}

// Helper function to validate difficulty
function validateDifficulty(difficulty) {
  const valid = ['beginner', 'intermediate', 'advanced'];
  return valid.includes(difficulty?.toLowerCase()) ? difficulty.toLowerCase() : 'intermediate';
}

// Helper function to estimate time
function estimateTimeByDifficulty(difficulty) {
  switch(difficulty?.toLowerCase()) {
    case 'beginner': return '2-3 hours';
    case 'intermediate': return '4-6 hours';
    case 'advanced': return '8-10 hours';
    default: return '3-5 hours';
  }
}

// ============= EXISTING CONTROLLER FUNCTIONS =============

 export const getTopics = async (req, res) => {
    try {
      const { 
        category, 
        difficulty, 
        search, 
        page = 1, 
        limit = 10,
        sortBy = 'popularity'
      } = req.query;

      const studentId = req.user.id;
      const filter = { isPublished: true };
      
      if (category && category !== 'All') filter.category = category;
      if (difficulty) filter.difficulty = difficulty;
      if (search) {
        filter.$text = { $search: search };
      }
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;
      let sortOptions = {};
      switch (sortBy) {
        case 'popularity':
          sortOptions = { popularity: -1 };
          break;
        case 'newest':
          sortOptions = { createdAt: -1 };
          break;
        case 'difficulty':
          sortOptions = { difficulty: 1 };
          break;
        case 'duration':
          sortOptions = { duration: 1 };
          break;
        default:
          sortOptions = { createdAt: -1 };
      }

      const topics = await Topic.find(filter)
        .populate('createdBy', 'name')
        .sort(sortOptions)
        .limit(limitNum)
        .skip(skip);
      const total = await Topic.countDocuments(filter);
      const progress = await Progress.findOne({ studentId });
      
      const topicsWithProgress = (topics || []).map(topic => {
        const topicProgress = progress?.topicsProgress?.find(
          tp => tp.topicId?.toString() === topic._id.toString()
        );
        
        return {
          ...topic.toObject(),
          userProgress: topicProgress ? {
            status: topicProgress.status || 'not_started',
            progress: topicProgress.progress || 0,
            lastAccessed: topicProgress.lastAccessed || null,
            timeSpent: topicProgress.timeSpent || 0
          } : {
            status: constants.PROGRESS_STATUS?.NOT_STARTED || 'not_started',
            progress: 0
          },
          isEnrolled: topic.enrolledStudents?.includes(studentId) || false
        };
      });

      let recommendedIds = [];
      try {
        const recommendations = await RecommendedTopics.findOne({ studentId });
        if (recommendations && recommendations.recommendations) {
          recommendedIds = recommendations.recommendations
            .filter(r => r.status === 'recommended')
            .map(r => r.topicId?.toString())
            .filter(id => id);
        }
      } catch (recError) {
        console.log('Error fetching recommendations:', recError.message);
      }

      res.json({
        success: true,
        data: {
          topics: topicsWithProgress,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: total || 0,
            pages: Math.ceil((total || 0) / limitNum)
          },
          filters: {
            categories: constants.TOPIC_CATEGORIES || [],
            difficulties: Object.values(constants.DIFFICULTY_LEVELS || {})
          },
          recommended: recommendedIds
        }
      });

    } catch (error) {
      console.error('Get topics error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching topics',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };

 export const getTopicById = async (req, res) => {
    try {
      const { id } = req.params;
      const studentId = req.user.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Topic ID is required'
        });
      }

      const topic = await Topic.findById(id)
        .populate('createdBy', 'name')
        .populate('prerequisites', 'title difficulty');
      
      if (!topic) {
        return res.status(404).json({
          success: false,
          message: 'Topic not found'
        });
      }

      const progress = await Progress.findOne({ studentId });
      const topicProgress = progress?.topicsProgress?.find(
        tp => tp.topicId?.toString() === id
      );

      const prerequisitesMet = await checkPrerequisites(topic.prerequisites || [], progress);

      let relatedTopics = [];
      try {
        relatedTopics = await Topic.find({
          _id: { $ne: id },
          $or: [
            { category: topic.category },
            { difficulty: topic.difficulty },
            { tags: { $in: topic.tags || [] } }
          ]
        })
        .limit(5)
        .select('title description difficulty duration thumbnail');
      } catch (relError) {
        console.log('Error fetching related topics:', relError.message);
      }

      if (topicProgress) {
        topicProgress.lastAccessed = new Date();
        await progress.save();
      } else {
        await trackTopicView(studentId, id);
      }

      res.json({
        success: true,
        data: {
          ...topic.toObject(),
          userProgress: topicProgress ? {
            status: topicProgress.status,
            progress: topicProgress.progress,
            lastAccessed: topicProgress.lastAccessed,
            timeSpent: topicProgress.timeSpent
          } : {
            status: constants.PROGRESS_STATUS?.NOT_STARTED || 'not_started',
            progress: 0
          },
          prerequisitesMet,
          relatedTopics: relatedTopics || [],
          isEnrolled: topic.enrolledStudents?.includes(studentId) || false,
          enrolledCount: topic.enrolledStudents?.length || 0
        }
      });

    } catch (error) {
      console.error('Get topic error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching topic',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };


// @desc    Start a topic with socket emission
  // @route   POST /api/topics/:id/start
  // @access  Private (Student)
  export const startTopic = async (req, res) => {
    try {
      const { id } = req.params;
      const studentId = req.user.id;
      const io = req.app.locals.io;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Topic ID is required'
        });
      }

      const topic = await Topic.findById(id);
      if (!topic) {
        return res.status(404).json({
          success: false,
          message: 'Topic not found'
        });
      }

      let progress = await Progress.findOne({ studentId });
      const prerequisitesMet = await checkPrerequisites(topic.prerequisites || [], progress);
      
      if (!prerequisitesMet) {
        return res.status(400).json({
          success: false,
          message: 'Complete prerequisites first',
          prerequisites: topic.prerequisites || []
        });
      }

      if (!progress) {
        progress = new Progress({ studentId, topicsProgress: [] });
      }

      if (!progress.topicsProgress) {
        progress.topicsProgress = [];
      }

      let topicProgress = progress.topicsProgress.find(
        tp => tp.topicId?.toString() === id
      );

      let isNewTopic = false;

      if (!topicProgress) {
        topicProgress = {
          topicId: id,
          status: constants.PROGRESS_STATUS?.IN_PROGRESS || 'in_progress',
          progress: 0,
          startedAt: new Date(),
          lastAccessed: new Date(),
          timeSpent: 0,
          completedLessons: [],
          quizAttempts: [],
          notes: []
        };
        progress.topicsProgress.push(topicProgress);
        
        if (!progress.stats) progress.stats = {};
        progress.stats.totalTopics = (progress.stats.totalTopics || 0) + 1;
        isNewTopic = true;
      } else if (topicProgress.status === (constants.PROGRESS_STATUS?.NOT_STARTED || 'not_started')) {
        topicProgress.status = constants.PROGRESS_STATUS?.IN_PROGRESS || 'in_progress';
        topicProgress.startedAt = new Date();
        isNewTopic = true;
      }

      topicProgress.lastAccessed = new Date();
      await progress.save();

      await Topic.findByIdAndUpdate(
        id,
        { $addToSet: { enrolledStudents: studentId } },
        { new: true, runValidators: false }
      );

      // Add activity
      try {
        await Activity.findOneAndUpdate(
          { studentId },
          {
            $push: {
              activities: {
                type: 'topic_started',
                title: 'Started Learning',
                description: `Started learning ${topic.title || 'a topic'}`,
                metadata: {
                  topicId: id,
                  topic: topic.title,
                  category: topic.category,
                  difficulty: topic.difficulty
                },
                icon: '🚀',
                color: '#10b981',
                importance: 'medium',
                timestamp: new Date()
              }
            }
          },
          { upsert: true }
        );
      } catch (actError) {
        console.log('Error adding activity:', actError.message);
      }

      // Update recommendation status
      try {
        await RecommendedTopics.findOneAndUpdate(
          { studentId, 'recommendations.topicId': id },
          { $set: { 'recommendations.$.status': 'started' } }
        );
      } catch (recError) {
        console.log('Error updating recommendation:', recError.message);
      }

      // Emit socket event for topic started
      if (io && isNewTopic) {
        io.to(`user:${studentId}`).emit('topic-started', {
          topicId: id,
          topicTitle: topic.title,
          category: topic.category,
          difficulty: topic.difficulty,
          timestamp: new Date()
        });
        
        await triggerProgressUpdate(io, studentId, 'topic_started', {
          topicId: id,
          topicTitle: topic.title
        });
      }

      res.json({
        success: true,
        message: 'Topic started successfully',
        data: {
          status: topicProgress.status,
          startedAt: topicProgress.startedAt,
          progress: topicProgress.progress || 0
        }
      });

    } catch (error) {
      console.error('Start topic error:', error);
      res.status(500).json({
        success: false,
        message: 'Error starting topic',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };


export const updateTopicProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const { progress: progressValue, lessonId, timeSpent } = req.body;
    const studentId = req.user.id;
    const io = req.app.locals.io;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Topic ID is required'
      });
    }

    const progress = await Progress.findOne({ studentId });
    
    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'Progress record not found'
      });
    }

    if (!progress.topicsProgress) {
      progress.topicsProgress = [];
    }

    const topicProgress = progress.topicsProgress.find(
      tp => tp.topicId?.toString() === id
    );

    if (!topicProgress) {
      return res.status(404).json({
        success: false,
        message: 'Topic progress not found. Start the topic first.'
      });
    }

    const oldProgress = topicProgress.progress;
    const wasCompleted = topicProgress.status === 'completed';

    // Update progress
    if (progressValue !== undefined) {
      topicProgress.progress = Math.min(100, Math.max(0, progressValue));
    }

    // Add completed lesson
    let lessonCompleted = false;
    if (lessonId) {
      if (!topicProgress.completedLessons) {
        topicProgress.completedLessons = [];
      }
      if (!topicProgress.completedLessons.some(l => l.lessonId === lessonId)) {
        topicProgress.completedLessons.push({
          lessonId,
          completedAt: new Date(),
          timeSpent: timeSpent || 0
        });
        lessonCompleted = true;
      }
    }

    // Update time spent and weekly study time
    if (timeSpent) {
      topicProgress.timeSpent = (topicProgress.timeSpent || 0) + timeSpent;
      
      if (!progress.stats) progress.stats = {};
      progress.stats.totalStudyTime = (progress.stats.totalStudyTime || 0) + timeSpent;
      
      // ✅ Update weekly study time
      await updateWeeklyStudyTime(studentId, timeSpent);
    }

    topicProgress.lastAccessed = new Date();

    let topicCompleted = false;
    let xpEarned = 0;
    let oldLevel = progress.stats?.level || 1;
    let newLevel = oldLevel;

    // Check if completed
    if (topicProgress.progress >= 100 && topicProgress.status !== (constants.PROGRESS_STATUS?.COMPLETED || 'completed')) {
      topicProgress.status = constants.PROGRESS_STATUS?.COMPLETED || 'completed';
      topicProgress.completedAt = new Date();
      topicCompleted = true;
      
      // Update stats
      if (!progress.stats) progress.stats = {};
      progress.stats.completedTopics = (progress.stats.completedTopics || 0) + 1;
      progress.stats.completedLessons = (progress.stats.completedLessons || 0) + 1;
      
      // Add XP
      xpEarned = 50;
      if (typeof progress.addXP === 'function') {
        progress.addXP(xpEarned);
      } else {
        progress.stats.xpPoints = (progress.stats.xpPoints || 0) + xpEarned;
      }

      // Add activity
      try {
        await Activity.findOneAndUpdate(
          { studentId },
          {
            $push: {
              activities: {
                type: 'topic_completed',
                title: 'Topic Completed',
                description: `Completed a topic`,
                metadata: {
                  topicId: id,
                  xpEarned: 50
                },
                icon: '✅',
                color: '#10b981',
                importance: 'high',
                timestamp: new Date()
              }
            }
          },
          { upsert: true }
        );
      } catch (actError) {
        console.log('Error adding activity:', actError.message);
      }
    }

    await progress.save();

    // Update Learning Path Progress
    await updateLearningPathProgress(studentId, id);

    // Update User Level based on total XP
    try {
      const userProgress = await Progress.findOne({ studentId });
      if (userProgress && userProgress.stats) {
        const totalXP = userProgress.stats.xpPoints || 0;
        const currentLevel = userProgress.stats.level || 1;
        newLevel = 1 + Math.floor(totalXP / 100);
        
        if (newLevel > currentLevel) {
          userProgress.stats.level = newLevel;
          userProgress.stats.levelUpAt = new Date();
          await userProgress.save();
          
          await Activity.findOneAndUpdate(
            { studentId },
            {
              $push: {
                activities: {
                  type: 'level_up',
                  title: `Level ${newLevel} Unlocked!`,
                  description: `Congratulations! You've reached level ${newLevel}`,
                  metadata: { oldLevel: currentLevel, newLevel, xp: totalXP },
                  icon: '🎉',
                  color: '#f59e0b',
                  importance: 'high',
                  timestamp: new Date()
                }
              }
            },
            { upsert: true }
          );
        }
      }
    } catch (levelError) {
      console.error('Error updating level:', levelError);
    }

    // Check for achievements
    const newAchievements = await checkTopicAchievementsWithEmit(studentId, progress, io);

    // ============ SOCKET.IO EMISSIONS ============
    
    if (io) {
      // Emit progress update if progress changed
      if (topicProgress.progress !== oldProgress) {
        await emitIncrementalUpdate(io, studentId, 'topic_progress', {
          topicId: id,
          oldProgress,
          newProgress: topicProgress.progress,
          lessonCompleted,
          timestamp: new Date()
        });
      }
      
      // Emit topic completion event
      if (topicCompleted) {
        io.to(`user:${studentId}`).emit('topic-completed', {
          topicId: id,
          xpEarned,
          message: `🎉 Congratulations! You've completed the topic! +${xpEarned} XP`,
          timestamp: new Date()
        });
        
        // Emit XP earned event
        io.to(`user:${studentId}`).emit('xp-earned', {
          amount: xpEarned,
          source: 'topic_completion',
          topicId: id,
          totalXP: progress.stats?.xpPoints,
          timestamp: new Date()
        });
      }
      
      // Emit level up event
      if (newLevel > oldLevel) {
        io.to(`user:${studentId}`).emit('level-up', {
          oldLevel,
          newLevel,
          source: 'topic_completion',
          message: `🎉 Congratulations! You've reached Level ${newLevel}!`,
          timestamp: new Date()
        });
      }
      
      // Emit new achievements
      if (newAchievements && newAchievements.length > 0) {
        io.to(`user:${studentId}`).emit('achievements-unlocked', {
          achievements: newAchievements,
          message: `🏆 You've unlocked ${newAchievements.length} new achievement(s)!`,
          timestamp: new Date()
        });
      }
      
      // Trigger full progress update
      if (topicCompleted || lessonCompleted) {
        await triggerProgressUpdate(io, studentId, 'topic_progress_updated', {
          topicId: id,
          completed: topicCompleted,
          progress: topicProgress.progress
        });
      }
    }
    
    // ============ END SOCKET EMISSIONS ============

    res.json({
      success: true,
      message: topicProgress.status === (constants.PROGRESS_STATUS?.COMPLETED || 'completed') 
        ? 'Topic completed! Great job!' 
        : 'Progress updated',
      data: {
        status: topicProgress.status,
        progress: topicProgress.progress,
        timeSpent: topicProgress.timeSpent || 0,
        completedLessons: topicProgress.completedLessons?.length || 0,
        xpEarned: topicCompleted ? 50 : 0,
        levelUp: newLevel > oldLevel,
        newLevel: newLevel > oldLevel ? newLevel : null,
        achievementsUnlocked: newAchievements || []
      }
    });

  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating progress',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

 export const searchTopics = async (req, res) => {
    try {
      const { q, category, difficulty, page = 1, limit = 10 } = req.query;

      if (!q || !q.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      const filter = { isPublished: true };
      
      let topics = [];
      let total = 0;

      try {
        filter.$text = { $search: q.trim() };
        
        if (category) filter.category = category;
        if (difficulty) filter.difficulty = difficulty;

        topics = await Topic.find(filter)
          .select('title description category difficulty duration thumbnail enrolledStudents')
          .sort({ score: { $meta: 'textScore' } })
          .limit(limitNum)
          .skip(skip);

        total = await Topic.countDocuments(filter);
      } catch (textSearchError) {
        console.log('Text search failed, using regex fallback:', textSearchError.message);
        
        const regexFilter = {
          isPublished: true,
          $or: [
            { title: { $regex: q.trim(), $options: 'i' } },
            { description: { $regex: q.trim(), $options: 'i' } },
            { tags: { $in: [new RegExp(q.trim(), 'i')] } }
          ]
        };
        
        if (category) regexFilter.category = category;
        if (difficulty) regexFilter.difficulty = difficulty;

        topics = await Topic.find(regexFilter)
          .select('title description category difficulty duration thumbnail enrolledStudents')
          .limit(limitNum)
          .skip(skip);

        total = await Topic.countDocuments(regexFilter);
      }

      await trackSearch(req.user.id, q, topics?.length || 0);

      res.json({
        success: true,
        data: {
          topics: topics || [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: total || 0,
            pages: Math.ceil((total || 0) / limitNum)
          },
          query: q
        }
      });

    } catch (error) {
      console.error('Search topics error:', error);
      res.status(500).json({
        success: false,
        message: 'Error searching topics',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };

  export const getUserStats = async (req, res) => {
    try {
      const studentId = req.user.id;
      
      const progress = await Progress.findOne({ studentId });
      
      if (!progress || !progress.stats) {
        return res.json({
          success: true,
          data: {
            level: 1,
            xp: 0,
            nextLevelXP: 500,
            progressToNextLevel: 0,
            totalTopicsCompleted: 0,
            totalQuizzesTaken: 0,
            averageScore: 0,
            learningStreak: 0
          }
        });
      }
      
      const totalXP = progress.stats.xpPoints || 0;
      const currentLevel = progress.stats.level || 1;
      const xpForNextLevel = currentLevel * 500;
      const xpInCurrentLevel = totalXP - ((currentLevel - 1) * 500);
      const progressToNextLevel = Math.min(100, (xpInCurrentLevel / 500) * 100);
      
      res.json({
        success: true,
        data: {
          level: currentLevel,
          xp: totalXP,
          nextLevelXP: xpForNextLevel,
          progressToNextLevel,
          totalTopicsCompleted: progress.stats.completedTopics || 0,
          totalQuizzesTaken: progress.stats.quizzesTaken || 0,
          averageScore: progress.stats.averageScore || 0,
          learningStreak: progress.stats.learningStreak || 0,
          achievements: progress.achievements || []
        }
      });
      
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching user stats',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };

  export const getRecommendedTopics = async (req, res) => {
    try {
      const studentId = req.user.id;

      const recommendations = await RecommendedTopics.findOne({ studentId });
      
      if (!recommendations) {
        return res.json({
          success: true,
          data: {
            forYou: [],
            trending: [],
            basedOnHistory: []
          }
        });
      }

      const forYouTopics = await getTopicDetails(recommendations.categories?.forYou || []);
      const trendingTopics = await getTopicDetails(recommendations.categories?.trending || []);
      const basedOnHistoryTopics = await getTopicDetails(recommendations.categories?.basedOnHistory || []);

      res.json({
        success: true,
        data: {
          forYou: forYouTopics,
          trending: trendingTopics,
          basedOnHistory: basedOnHistoryTopics,
          lastGenerated: recommendations.lastGenerated
        }
      });

    } catch (error) {
      console.error('Get recommended topics error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching recommendations',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };

  export const getCategories = async (req, res) => {
    try {
      if (!constants.TOPIC_CATEGORIES || !Array.isArray(constants.TOPIC_CATEGORIES)) {
        return res.json({
          success: true,
          data: []
        });
      }

      const categoryPromises = constants.TOPIC_CATEGORIES.map(async (category) => {
        try {
          const count = await Topic.countDocuments({ category, isPublished: true });
          return {
            name: category,
            count: count || 0
          };
        } catch (err) {
          console.log(`Error counting category ${category}:`, err.message);
          return {
            name: category,
            count: 0
          };
        }
      });

      const categories = await Promise.all(categoryPromises);

      res.json({
        success: true,
        data: categories
      });

    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching categories',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };

  export const getTopicStats = async (req, res) => {
    try {
      const studentId = req.user.id;

      const progress = await Progress.findOne({ studentId });
      
      if (!progress) {
        return res.json({
          success: true,
          data: {
            stats: {
              totalTopics: 0,
              completedTopics: 0,
              inProgressTopics: 0,
              notStartedTopics: 0,
              totalTimeSpent: 0,
              averageProgress: 0
            },
            topics: []
          }
        });
      }

      const topics = progress.topicsProgress || [];
      
      const stats = {
        totalTopics: topics.length,
        completedTopics: topics.filter(t => t.status === 'completed').length,
        inProgressTopics: topics.filter(t => t.status === 'in_progress').length,
        notStartedTopics: topics.filter(t => t.status === 'not_started').length,
        totalTimeSpent: progress.stats?.totalStudyTime || 0,
        averageProgress: topics.length > 0
          ? topics.reduce((sum, t) => sum + (t.progress || 0), 0) / topics.length
          : 0
      };

      const topicDetails = await Promise.all(
        topics.map(async t => {
          if (!t.topicId) return null;
          try {
            const topic = await Topic.findById(t.topicId).select('title category difficulty duration');
            return {
              ...t.toObject(),
              details: topic
            };
          } catch (err) {
            console.log(`Error fetching topic ${t.topicId}:`, err.message);
            return null;
          }
        })
      );

      res.json({
        success: true,
        data: {
          stats,
          topics: topicDetails.filter(t => t !== null)
        }
      });

    } catch (error) {
      console.error('Get topic stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching topic statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : {}
      });
    }
  };


// ============= AI-POWERED DISCOVERY =============

// @desc    AI-Powered Topic Discovery (Hybrid: DB + AI)
// @route   POST /api/topics/discover
// @access  Private (Student)
export const discoverTopics = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { query, difficulty, goal } = req.body;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }
    
    // STEP 1: Check database for existing topics
    const dbTopics = await Topic.find({
      title: { $regex: query, $options: 'i' },
      isPublished: true
    })
    .select('title description difficulty duration thumbnail category enrolledStudents')
    .limit(5);
    
    if (dbTopics.length > 0) {
      
      const progress = await Progress.findOne({ studentId });
      
      const topicsWithProgress = dbTopics.map(topic => {
        const topicProgress = progress?.topicsProgress?.find(
          tp => tp.topicId?.toString() === topic._id.toString()
        );
        
        return {
          _id: topic._id,
          title: topic.title,
          description: topic.description,
          difficulty: topic.difficulty,
          duration: topic.duration,
          category: topic.category,
          thumbnail: topic.thumbnail,
          isAIGenerated: false,
          source: 'database',
          userProgress: topicProgress ? {
            status: topicProgress.status || 'not_started',
            progress: topicProgress.progress || 0
          } : { status: 'not_started', progress: 0 }
        };
      });
      
      return res.json({
        success: true,
        data: topicsWithProgress,
        source: 'database',
        message: `Found ${dbTopics.length} topics matching "${query}"`
      });
    }
    
    // STEP 2: Get user context for personalization
    let mentalState = null;
    let quizHistory = null;
    let progress = null;
    
    try {
      [mentalState, quizHistory, progress] = await Promise.all([
        MentalState.findOne({ studentId }),
        QuizHistory.findOne({ studentId }),
        Progress.findOne({ studentId })
      ]);
    } catch (err) {
      console.log('Error fetching user context:', err.message);
    }
    
    // Extract weak topics from quiz history
    const weakTopics = quizHistory?.statistics?.weakTopics?.map(w => w.topic) || [];
    
    if (!aiService || typeof aiService.discoverTopics !== 'function') {
      console.error('❌ AI Service not available');
      return res.status(503).json({
        success: false,
        message: 'AI service temporarily unavailable. Please try again later.'
      });
    }
    
    const aiTopics = await aiService.discoverTopics({
      query: query.trim(),
      difficulty: difficulty || 'intermediate',
      goal: goal || 'mastery',
      mentalState: mentalState?.currentState,
      weakTopics: weakTopics.slice(0, 3)
    });
    
    // ✅ FIXED: Use the helper functions correctly (no 'this')
    const formattedAITopics = (aiTopics || []).map((topic, index) => ({
      _id: `ai_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 6)}`,
      title: topic.title || `${query} - Topic ${index + 1}`,
      description: topic.description || `Learn about ${topic.title || query} in this comprehensive guide.`,
      difficulty: validateDifficulty(topic.difficulty || difficulty || 'intermediate'),
      duration: parseDurationToMinutes(topic.estimatedTime || estimateTimeByDifficulty(topic.difficulty)),
      category: 'AI Generated',
      skills: Array.isArray(topic.skills) ? topic.skills.slice(0, 5) : [`${query} Fundamentals`],
      whyRecommended: topic.whyRecommended || `Based on your interest in ${query}`,
      isAIGenerated: true,
      source: 'ai',
      userProgress: { status: 'not_started', progress: 0 }
    }));
    
    res.json({
      success: true,
      data: formattedAITopics,
      source: 'ai',
      message: `AI-generated topics for "${query}"`,
      context: {
        difficulty: difficulty || 'intermediate',
        goal: goal || 'mastery',
        weakTopics: weakTopics.slice(0, 3)
      }
    });
    
  } catch (error) {
    console.error('❌ Discover topics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error discovering topics',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// backend/controllers/topicController.js
// Add this helper function near the top with other helpers

// Helper function to update weekly study time
const updateWeeklyStudyTime = async (studentId, minutes) => {
  try {
    const progress = await Progress.findOne({ studentId });
    if (!progress) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get or create current week
    if (!progress.weeklyActivity || progress.weeklyActivity.length === 0) {
      progress.weeklyActivity = [];
    }
    
    // Get current week (last item or create new)
    let currentWeek = progress.weeklyActivity[progress.weeklyActivity.length - 1];
    const weekStart = getWeekStart(today);
    
    if (!currentWeek || new Date(currentWeek.startDate).getTime() !== weekStart.getTime()) {
      // Create new week
      currentWeek = {
        startDate: weekStart,
        days: generateEmptyWeek(weekStart),
        totalStudyTime: 0,
        totalXpEarned: 0
      };
      progress.weeklyActivity.push(currentWeek);
    }
    
    // Find today's day entry
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[today.getDay()];
    const dayEntry = currentWeek.days.find(d => d.dayName === dayName);
    
    if (dayEntry) {
      dayEntry.studyTime = (dayEntry.studyTime || 0) + minutes;
      currentWeek.totalStudyTime = (currentWeek.totalStudyTime || 0) + minutes;
    }
    
    await progress.save();
  } catch (error) {
    console.error('Error updating weekly study time:', error);
  }
};

const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

const generateEmptyWeek = (startDate) => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekDays = [];
  const start = new Date(startDate);
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    weekDays.push({
      dayName: days[i],
      date: date,
      studyTime: 0,
      quizzesTaken: 0,
      topicsCompleted: 0,
      xpEarned: 0
    });
  }
  
  return weekDays;
};

// @desc    Start AI-generated topic (creates learning path)
// @route   POST /api/topics/ai/start
// @access  Private (Student)
export const startAITopic = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { title, description, difficulty, estimatedTime, skills } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Topic title is required'
      });
    }
    
    // Create a learning path from the AI-generated topic
    const learningPathService = (await import('../services/learningPathService.js')).default;
    
    const result = await learningPathService.generatePath(studentId, {
      goal: title,
      difficulty: difficulty || 'intermediate',
      timeCommitment: 5,
      forceCreate: true
    });
    
    if (result.success) {
      // Add activity
      await Activity.findOneAndUpdate(
        { studentId },
        {
          $push: {
            activities: {
              type: 'ai_topic_started',
              title: `Started Learning: ${title}`,
              description: description || `Started learning ${title} via AI discovery`,
              metadata: {
                topic: title,
                difficulty,
                estimatedTime,
                skills,
                source: 'ai_discovery'
              },
              icon: '🤖',
              color: '#8b5cf6',
              importance: 'medium',
              timestamp: new Date()
            }
          }
        },
        { upsert: true }
      );
      
      // Emit socket event
      const io = req.app.locals.io;
      if (io) {
        io.to(`user:${studentId}`).emit('ai-topic-started', {
          topic: title,
          timestamp: new Date()
        });
      }
    }
    
    res.json({
      success: true,
      message: `Learning path for "${title}" created successfully!`,
      data: result.data
    });
    
  } catch (error) {
    console.error('❌ Start AI topic error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create learning path',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ============= HELPER FUNCTIONS (EXISTING) =============

// Enhanced checkTopicAchievements with socket emission
  const checkTopicAchievementsWithEmit = async (studentId, progress, io) => {
    try {
      if (!progress || !progress.stats) return [];

      const achievements = [];
      const completedCount = progress.stats.completedTopics || 0;
      const newAchievements = [];
      
      if (completedCount === 1) {
        achievements.push({
          achievementId: 'first_topic',
          name: 'First Steps',
          description: 'Completed your first topic',
          icon: '🎯',
          xpReward: 50
        });
      } else if (completedCount === 5) {
        achievements.push({
          achievementId: 'five_topics',
          name: 'Getting Serious',
          description: 'Completed 5 topics',
          icon: '📚',
          xpReward: 100
        });
      } else if (completedCount === 10) {
        achievements.push({
          achievementId: 'ten_topics',
          name: 'Knowledge Seeker',
          description: 'Completed 10 topics',
          icon: '🎓',
          xpReward: 200
        });
      } else if (completedCount === 25) {
        achievements.push({
          achievementId: 'twenty_five_topics',
          name: 'Dedicated Learner',
          description: 'Completed 25 topics',
          icon: '🏆',
          xpReward: 500
        });
      } else if (completedCount === 50) {
        achievements.push({
          achievementId: 'fifty_topics',
          name: 'Learning Master',
          description: 'Completed 50 topics',
          icon: '👑',
          xpReward: 1000
        });
      }

      if (achievements.length > 0) {
        if (!progress.achievements) progress.achievements = [];
        
        for (const achievement of achievements) {
          const alreadyEarned = progress.achievements.some(a => a.achievementId === achievement.achievementId);
          if (!alreadyEarned) {
            progress.achievements.push({
              ...achievement,
              earnedAt: new Date()
            });
            
            if (typeof progress.addXP === 'function') {
              progress.addXP(achievement.xpReward);
            } else {
              progress.stats.xpPoints = (progress.stats.xpPoints || 0) + achievement.xpReward;
            }
            newAchievements.push(achievement);
            
            // Emit individual achievement via socket
            if (io) {
              io.to(`user:${studentId}`).emit('achievement-earned', {
                achievement,
                timestamp: new Date()
              });
            }
          }
        }
        await progress.save();
      }
      
      return newAchievements;
    } catch (error) {
      console.log('Error checking achievements:', error.message);
      return [];
    }
  };

  // @desc    Get topic progress snapshot for socket
  // @route   (Internal function)
  export const getTopicProgressSnapshot = async (studentId) => {
    try {
      const progress = await Progress.findOne({ studentId });
      
      if (!progress || !progress.topicsProgress) {
        return {
          totalTopics: 0,
          completedTopics: 0,
          inProgressTopics: 0,
          averageProgress: 0
        };
      }
      
      const topics = progress.topicsProgress;
      const completedTopics = topics.filter(t => t.status === 'completed').length;
      const inProgressTopics = topics.filter(t => t.status === 'in_progress').length;
      const averageProgress = topics.length > 0
        ? topics.reduce((sum, t) => sum + (t.progress || 0), 0) / topics.length
        : 0;
      
      return {
        totalTopics: topics.length,
        completedTopics,
        inProgressTopics,
        averageProgress: Math.round(averageProgress)
      };
    } catch (error) {
      console.error('Error getting topic progress snapshot:', error);
      return null;
    }
  };

  // ============= EXISTING HELPER FUNCTIONS =============

  const checkPrerequisites = async (prerequisites, progress) => {
    if (!prerequisites || prerequisites.length === 0) return true;

    const completedTopics = progress?.topicsProgress
      ?.filter(t => t.status === 'completed')
      .map(t => t.topicId?.toString()) || [];

    return prerequisites.every(prereq => 
      completedTopics.includes(prereq.toString())
    );
  };

  const trackTopicView = async (studentId, topicId) => {
    try {
      const recommendations = await RecommendedTopics.findOne({ studentId });
      
      if (recommendations && recommendations.recommendations) {
        const recommendation = recommendations.recommendations.find(
          r => r.topicId?.toString() === topicId
        );
        
        if (recommendation && recommendation.status === 'recommended') {
          recommendation.status = 'viewed';
          recommendation.viewedAt = new Date();
          await recommendations.save();
        }
      }
    } catch (error) {
      console.log('Error tracking topic view:', error.message);
    }
  };

  const trackSearch = async (studentId, query, resultsCount) => {
    console.log(`Search tracked: ${studentId} searched "${query}" - ${resultsCount} results`);
  };

  const getTopicDetails = async (topicRefs) => {
    if (!topicRefs || topicRefs.length === 0) return [];

    const topicIds = topicRefs.map(ref => ref.topicId).filter(id => id);
    
    if (topicIds.length === 0) return [];

    const topics = await Topic.find({
      _id: { $in: topicIds },
      isPublished: true
    }).select('title description category difficulty duration thumbnail');

    return topics.map(topic => {
      const ref = topicRefs.find(r => r.topicId?.toString() === topic._id.toString());
      return {
        ...topic.toObject(),
        relevanceScore: ref?.score || ref?.popularity || 50,
        reason: ref?.reason || 'Recommended for you'
      };
    });
  };

  const updateLearningPathProgress = async (studentId, topicId) => {
    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (!learningPath || !learningPath.currentPath || !learningPath.currentPath.milestones) {
        return;
      }

      let updated = false;
      
      for (let milestoneIndex = 0; milestoneIndex < learningPath.currentPath.milestones.length; milestoneIndex++) {
        const milestone = learningPath.currentPath.milestones[milestoneIndex];
        
        if (!milestone.topics) continue;
        
        const topicIndex = milestone.topics.findIndex(
          t => t.topicId?.toString() === topicId.toString()
        );
        
        if (topicIndex >= 0) {
          milestone.topics[topicIndex].status = 'completed';
          milestone.topics[topicIndex].completedAt = new Date();
          updated = true;
          
          const completedTopics = milestone.topics.filter(t => t.status === 'completed').length;
          milestone.progress = (completedTopics / milestone.topics.length) * 100;
          
          const allTopicsCompleted = milestone.topics.every(t => t.status === 'completed');
          const allQuizzesPassed = milestone.quizzes?.every(q => q.status === 'passed') ?? true;
          const allProjectsCompleted = milestone.projects?.every(p => p.status === 'completed') ?? true;
          
          if (allTopicsCompleted && allQuizzesPassed && allProjectsCompleted) {
            milestone.status = 'completed';
            milestone.completedAt = new Date();
            
            if (milestoneIndex + 1 < learningPath.currentPath.milestones.length) {
              const nextMilestone = learningPath.currentPath.milestones[milestoneIndex + 1];
              if (nextMilestone.status === 'locked') {
                nextMilestone.status = 'available';
              }
            }
          } else if (milestone.status === 'locked') {
            milestone.status = 'in_progress';
            milestone.startedAt = milestone.startedAt || new Date();
          }
          
          break;
        }
      }
      
      if (updated) {
        let totalProgress = 0;
        learningPath.currentPath.milestones.forEach(milestone => {
          totalProgress += milestone.progress || 0;
        });
        learningPath.currentPath.progress = totalProgress / learningPath.currentPath.milestones.length;
        learningPath.currentPath.lastUpdated = new Date();
        
        await learningPath.save();
      }
      
    } catch (error) {
      console.error('Error updating learning path:', error);
    }
  };

// Keep original for backward compatibility
const checkTopicAchievements = async (studentId, progress) => {
  return checkTopicAchievementsWithEmit(studentId, progress, null);
};