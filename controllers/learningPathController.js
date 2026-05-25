// backend/controllers/learningPathController.js
import LearningPath from '../models/LearningPath.js';
import StudentProgress from '../models/StudentProgress.js';
import Activity from '../models/Activity.js';
import learningPathService from '../services/learningPathService.js';
import mongoose from 'mongoose';

// ============= HELPER FUNCTIONS =============

const createDefaultMilestones = (goalTitle, difficulty = 'intermediate') => {
  const isAdvanced = difficulty === 'advanced';
  const isBeginner = difficulty === 'beginner';
  
  return [
    {
      _id: new mongoose.Types.ObjectId(),
      title: "Foundations",
      description: `Learn the core concepts and basics of ${goalTitle}`,
      order: 0,
      status: "available",
      topics: [
        {
          _id: new mongoose.Types.ObjectId(),
          title: `Introduction to ${goalTitle}`,
          description: `Get started with the basics of ${goalTitle}`,
          estimatedTime: 60,
          skills: ["Fundamentals"],
          status: "pending"
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: `Core Principles of ${goalTitle}`,
          description: `Understand the key principles of ${goalTitle}`,
          estimatedTime: 90,
          skills: ["Core Concepts"],
          status: "pending"
        }
      ],
      estimatedTime: 150,
      progress: 0,
      quizzes: [],
      projects: []
    },
    {
      _id: new mongoose.Types.ObjectId(),
      title: isBeginner ? "Practical Application" : "Core Concepts",
      description: isBeginner 
        ? `Apply your ${goalTitle} knowledge in practical scenarios`
        : `Master the essential concepts of ${goalTitle}`,
      order: 1,
      status: "locked",
      topics: isBeginner ? [
        {
          _id: new mongoose.Types.ObjectId(),
          title: `Practical ${goalTitle} Projects`,
          description: `Build real-world projects using ${goalTitle}`,
          estimatedTime: 180,
          skills: ["Project Building", "Problem Solving"],
          status: "pending"
        }
      ] : [
        {
          _id: new mongoose.Types.ObjectId(),
          title: `Advanced ${goalTitle}`,
          description: `Deep dive into advanced concepts of ${goalTitle}`,
          estimatedTime: 120,
          skills: ["Advanced Concepts"],
          status: "pending"
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: `Best Practices in ${goalTitle}`,
          description: `Learn industry best practices for ${goalTitle}`,
          estimatedTime: 90,
          skills: ["Best Practices"],
          status: "pending"
        }
      ],
      estimatedTime: isBeginner ? 180 : 210,
      progress: 0,
      quizzes: [],
      projects: []
    },
    {
      _id: new mongoose.Types.ObjectId(),
      title: isAdvanced ? "Advanced Topics" : "Mastery Project",
      description: isAdvanced 
        ? `Explore advanced ${goalTitle} concepts and techniques`
        : `Complete a final project to demonstrate ${goalTitle} mastery`,
      order: 2,
      status: "locked",
      topics: [
        {
          _id: new mongoose.Types.ObjectId(),
          title: isAdvanced ? `Advanced ${goalTitle} Techniques` : `Capstone Project: ${goalTitle}`,
          description: isAdvanced 
            ? `Master complex topics in ${goalTitle}`
            : `Build a complete project from scratch using ${goalTitle}`,
          estimatedTime: 240,
          skills: isAdvanced ? ["Advanced Techniques", "Optimization"] : ["Project Building", "Integration"],
          status: "pending"
        }
      ],
      estimatedTime: 240,
      progress: 0,
      quizzes: [],
      projects: []
    }
  ];
};

// ============= CONTROLLER FUNCTIONS =============

// @desc    Get current learning path
export const getCurrentLearningPath = async (req, res) => {
  try {
    const studentId = req.user.id;

    let learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      learningPath = new LearningPath({ 
        studentId, 
        paths: [],
        currentPathId: null 
      });
      await learningPath.save();
    }
    
    const currentPath = learningPath.paths.find(p => p._id.toString() === learningPath.currentPathId?.toString());
    
    if (!currentPath) {
      return res.json({
        success: true,
        data: {
          goal: "",
          description: "",
          milestones: [],
          totalProgress: 0,
          hasLearningPath: false
        }
      });
    }
    
    if (!currentPath.milestones || currentPath.milestones.length === 0) {
      return res.json({
        success: true,
        data: {
          goal: currentPath.goal || "",
          description: currentPath.description || "",
          milestones: [],
          totalProgress: currentPath.progress || 0,
          hasLearningPath: false
        }
      });
    }
    
    const formattedMilestones = currentPath.milestones.map((milestone, index) => {
      let displayStatus;
      if (milestone.status === 'completed') {
        displayStatus = 'Completed';
      } else if (milestone.status === 'available' || milestone.status === 'in_progress') {
        displayStatus = 'In Progress';
      } else {
        displayStatus = 'Locked';
      }
      
      const formattedTopics = (milestone.topics || []).map(topic => ({
        _id: topic._id,
        title: topic.title || 'Topic',
        description: topic.description || '',
        status: topic.status || 'pending',
        estimatedTime: topic.estimatedTime || 60,
        skills: topic.skills || [],
        completedAt: topic.completedAt,
        timeSpent: topic.timeSpent || 0
      }));
      
      return {
        step: index + 1,
        _id: milestone._id,
        title: milestone.title,
        topic: milestone.title,
        status: displayStatus,
        duration: `${milestone.estimatedTime || 60} min`,
        description: milestone.description || `Master ${milestone.title}`,
        skills: milestone.skills || [],
        progress: milestone.progress || 0,
        topics: formattedTopics,
        resources: milestone.resources || [],
        order: milestone.order,
        completedAt: milestone.completedAt,
        estimatedTime: milestone.estimatedTime,
        milestoneId: milestone._id
      };
    });

    res.json({
      success: true,
      data: {
        goal: currentPath.goal || "Your Learning Journey",
        description: currentPath.description || "",
        milestones: formattedMilestones,
        totalProgress: currentPath.progress || 0,
        hasLearningPath: true
      }
    });

  } catch (error) {
    console.error('Get learning path error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching learning path',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ✅ ADD THIS ALIAS for frontend compatibility
export const getCurrentPath = getCurrentLearningPath;

// ✅ ADD THIS METHOD for user stats
export const getUserStats = async (req, res) => {
  try {
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId });
    
    if (!progress || !progress.stats) {
      return res.json({
        success: true,
        data: {
          level: 1,
          xp: 0,
          streak: 0,
          nextLevelXP: 500,
          progressToNextLevel: 0,
          totalTopicsCompleted: 0,
          totalQuizzesTaken: 0,
          averageScore: 0
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
        streak: progress.stats.learningStreak || 0,
        nextLevelXP: xpForNextLevel,
        progressToNextLevel,
        totalTopicsCompleted: progress.stats.completedTopics || 0,
        totalQuizzesTaken: progress.stats.quizzesTaken || 0,
        averageScore: progress.stats.averageScore || 0
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

// @desc    Generate learning path
export const generateLearningPath = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { topic, difficulty, goal, timeCommitment, forceCreate = false } = req.body;

    const learningGoal = (topic || goal).toLowerCase().trim();

    if (!learningGoal) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }

    let learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      learningPath = new LearningPath({ studentId, paths: [] });
    }

    const existingPath = learningPath.paths.find(p => p.goal.toLowerCase() === learningGoal);
    
    if (existingPath && !forceCreate) {
      return res.json({
        success: false,
        warning: true,
        message: `A learning path for "${learningGoal}" already exists`,
        existingPath: {
          goal: existingPath.goal,
          progress: existingPath.progress,
          status: existingPath.status,
          pathId: existingPath._id
        }
      });
    }

    if (existingPath && forceCreate) {
      const pathIndex = learningPath.paths.findIndex(p => p.goal.toLowerCase() === learningGoal);
      if (pathIndex !== -1) {
        learningPath.paths.splice(pathIndex, 1);
      }
    }

    const goalTitle = learningGoal.charAt(0).toUpperCase() + learningGoal.slice(1);
    const milestones = createDefaultMilestones(goalTitle, difficulty || 'intermediate');
    
    const newPath = {
      _id: new mongoose.Types.ObjectId(),
      goal: learningGoal,
      description: `Master ${goalTitle} through this structured learning path`,
      difficulty: difficulty || 'intermediate',
      milestones: milestones,
      progress: 0,
      status: 'in_progress',
      startedAt: new Date(),
      lastAccessedAt: new Date(),
      estimatedDuration: { value: parseInt(timeCommitment) || 4, unit: 'weeks' }
    };

    learningPath.paths.push(newPath);
    learningPath.currentPathId = newPath._id;
    
    await learningPath.save();

    const formattedMilestones = newPath.milestones.map((milestone, index) => ({
      step: index + 1,
      _id: milestone._id,
      title: milestone.title,
      topic: milestone.title,
      status: milestone.status === "completed" ? "Completed" : 
              milestone.status === "available" ? "In Progress" : "Locked",
      duration: `${milestone.estimatedTime || 60} min`,
      description: milestone.description,
      skills: milestone.topics?.flatMap(t => t.skills) || [],
      progress: milestone.progress || 0,
      topics: milestone.topics || [],
      resources: milestone.resources || [],
      order: milestone.order,
      milestoneId: milestone._id
    }));

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-generated', {
        goal: learningGoal,
        pathId: newPath._id,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: {
        goal: newPath.goal,
        description: newPath.description,
        milestones: formattedMilestones,
        totalProgress: 0,
        hasLearningPath: true
      },
      message: 'Learning path created successfully'
    });

  } catch (error) {
    console.error('Generate learning path error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate learning path',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get all paths for user
export const getAllPaths = async (req, res) => {
  try {
    const studentId = req.user.id;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath || !learningPath.paths || learningPath.paths.length === 0) {
      return res.json({
        success: true,
        data: {
          activePath: null,
          inProgressPaths: [],
          completedPaths: [],
          pausedPaths: [],
          allPaths: []
        }
      });
    }

    const currentPathId = learningPath.currentPathId?.toString();
    
    const activePath = learningPath.paths.find(p => p._id.toString() === currentPathId);
    const inProgressPaths = learningPath.paths.filter(p => 
      p.status === 'in_progress' && p._id.toString() !== currentPathId
    );
    const completedPaths = learningPath.paths.filter(p => p.status === 'completed');
    const pausedPaths = learningPath.paths.filter(p => p.status === 'paused');

    res.json({
      success: true,
      data: {
        activePath: activePath || null,
        inProgressPaths: inProgressPaths,
        completedPaths: completedPaths,
        pausedPaths: pausedPaths,
        allPaths: learningPath.paths
      }
    });

  } catch (error) {
    console.error('Get all paths error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching learning paths' 
    });
  }
};

// @desc    Switch to another path
export const switchToPath = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { pathId } = req.params;
    const io = req.app.locals.io;

    const learningPath = await LearningPath.findOne({ studentId });

    if (!learningPath) {
      return res.status(404).json({ success: false, message: 'No learning path found' });
    }

    const targetPath = learningPath.paths.find(p => p._id.toString() === pathId);
    
    if (!targetPath) {
      return res.status(404).json({ success: false, message: 'Path not found' });
    }

    learningPath.currentPathId = targetPath._id;
    targetPath.lastAccessedAt = new Date();
    
    await learningPath.save();

    const formattedMilestones = (targetPath.milestones || []).map((milestone, index) => ({
      step: index + 1,
      _id: milestone._id,
      title: milestone.title,
      topic: milestone.title,
      status: milestone.status === "completed" ? "Completed" : 
              milestone.status === "available" || milestone.status === "in_progress" ? "In Progress" : "Locked",
      duration: `${milestone.estimatedTime || 60} min`,
      description: milestone.description || `Master ${milestone.title}`,
      skills: milestone.topics?.flatMap(t => t.skills) || milestone.skills || [],
      progress: milestone.progress || 0,
      topics: (milestone.topics || []).map(topic => ({
        _id: topic._id,
        title: topic.title,
        description: topic.description,
        status: topic.status || 'pending',
        estimatedTime: topic.estimatedTime || 60,
        skills: topic.skills || [],
        completedAt: topic.completedAt,
        timeSpent: topic.timeSpent || 0
      })),
      resources: milestone.resources || [],
      order: milestone.order,
      completedAt: milestone.completedAt,
      estimatedTime: milestone.estimatedTime,
      milestoneId: milestone._id
    }));

    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-switched', {
        newPath: targetPath.goal,
        milestones: targetPath.milestones?.length || 0,
        progress: targetPath.progress,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Switched to learning path successfully',
      data: {
        goal: targetPath.goal,
        description: targetPath.description,
        milestones: formattedMilestones,
        totalProgress: targetPath.progress || 0,
        hasLearningPath: true
      }
    });

  } catch (error) {
    console.error('Switch path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error switching learning path',
      error: error.message 
    });
  }
};

// @desc    Complete a topic
export const completeTopic = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { milestoneId, topicIndex, timeSpent = 30 } = req.body;

    if (!milestoneId || topicIndex === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Milestone ID and topic index are required' 
      });
    }

    const learningPath = await LearningPath.findOne({ studentId });

    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'Learning path not found' 
      });
    }

    const currentPath = learningPath.paths.find(p => p._id.toString() === learningPath.currentPathId?.toString());
    
    if (!currentPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active learning path' 
      });
    }

    const milestone = currentPath.milestones.find(m => m._id.toString() === milestoneId);
    
    if (!milestone) {
      return res.status(404).json({ 
        success: false, 
        message: 'Milestone not found' 
      });
    }
    
    if (!milestone.topics || topicIndex >= milestone.topics.length) {
      return res.status(404).json({ 
        success: false, 
        message: 'Topic not found' 
      });
    }

    const topic = milestone.topics[topicIndex];
    
    if (topic.status === 'completed') {
      return res.status(400).json({ 
        success: false, 
        message: 'Topic already completed' 
      });
    }

    const topicTitle = topic.title;
    topic.status = 'completed';
    topic.completedAt = new Date();
    topic.timeSpent = (topic.timeSpent || 0) + timeSpent;

    const totalTopics = milestone.topics.length;
    const completedTopics = milestone.topics.filter(t => t.status === 'completed').length;
    milestone.progress = (completedTopics / totalTopics) * 100;

    let milestoneCompleted = false;
    const allTopicsCompleted = milestone.topics.every(t => t.status === 'completed');

    if (allTopicsCompleted) {
      milestone.status = 'completed';
      milestone.completedAt = new Date();
      milestoneCompleted = true;

      const milestoneIndex = currentPath.milestones.findIndex(m => m._id.toString() === milestoneId);
      if (milestoneIndex + 1 < currentPath.milestones.length) {
        const nextMilestone = currentPath.milestones[milestoneIndex + 1];
        if (nextMilestone.status === 'locked') {
          nextMilestone.status = 'available';
        }
      }
    }

    let totalPathProgress = 0;
    currentPath.milestones.forEach(m => {
      totalPathProgress += m.progress || 0;
    });
    const newOverallProgress = currentPath.milestones.length > 0 
      ? totalPathProgress / currentPath.milestones.length 
      : 0;
    currentPath.progress = newOverallProgress;
    currentPath.lastAccessedAt = new Date();
    
    if (newOverallProgress >= 100) {
      currentPath.status = 'completed';
      currentPath.completedAt = new Date();
    } else if (newOverallProgress > 0) {
      currentPath.status = 'in_progress';
    }
    
    await learningPath.save();

    const xpEarned = 50;
    let leveledUp = false;
    let newLevel = null;
    
    const progressData = await StudentProgress.findOne({ studentId });
    
    if (progressData) {
      const oldLevel = progressData.stats.level || 1;
      
      if (!progressData.stats) progressData.stats = {};
      progressData.stats.xpPoints = (progressData.stats.xpPoints || 0) + xpEarned;
      
      const totalXP = progressData.stats.xpPoints;
      newLevel = 1 + Math.floor(totalXP / 100);
      
      if (newLevel > oldLevel) {
        progressData.stats.level = newLevel;
        progressData.stats.levelUpAt = new Date();
        leveledUp = true;
      }
      await progressData.save();
    }

    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'topic_completed',
            title: `Completed: ${topicTitle}`,
            description: `Completed topic in ${milestone.title}`,
            metadata: { 
              topicTitle, 
              milestoneTitle: milestone.title, 
              xpEarned, 
              timeSpent 
            },
            icon: '✅',
            color: '#10b981',
            importance: 'medium',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('topic-completed', {
        topicTitle,
        milestoneTitle: milestone.title,
        xpEarned,
        milestoneCompleted,
        overallProgress: newOverallProgress,
        leveledUp,
        newLevel: leveledUp ? newLevel : null,
        timestamp: new Date()
      });
      
      io.to(`user:${studentId}`).emit('progress-update', {
        type: 'topic_completed',
        data: {
          xpEarned,
          leveledUp,
          newLevel
        },
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Topic completed successfully',
      data: {
        topicCompleted: topicTitle,
        xpEarned,
        milestoneCompleted,
        milestoneProgress: milestone.progress,
        overallProgress: newOverallProgress,
        newLevel: leveledUp ? newLevel : null,
        leveledUp
      }
    });

  } catch (error) {
    console.error('Complete topic error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error completing topic',
      error: error.message 
    });
  }
};

// @desc    Pause current path
export const pauseCurrentPath = async (req, res) => {
  try {
    const studentId = req.user.id;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No learning path found' 
      });
    }
    
    const currentPath = learningPath.paths.find(p => p._id.toString() === learningPath.currentPathId?.toString());
    
    if (!currentPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active learning path to pause' 
      });
    }
    
    currentPath.status = 'paused';
    await learningPath.save();
    
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-paused', {
        goal: currentPath.goal,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Learning path paused successfully'
    });
    
  } catch (error) {
    console.error('Pause path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error pausing learning path' 
    });
  }
};

// @desc    Resume a paused learning path
export const resumePath = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { pathId, goal } = req.body;
    
    if (!pathId && !goal) {
      return res.status(400).json({ 
        success: false, 
        message: 'Either pathId or goal is required to resume a path' 
      });
    }
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No learning path found for this user' 
      });
    }
    
    let targetPath = null;
    
    if (pathId) {
      targetPath = learningPath.paths.find(p => p._id.toString() === pathId);
    }
    
    if (!targetPath && goal) {
      targetPath = learningPath.paths.find(p => p.goal.toLowerCase() === goal.toLowerCase());
    }
    
    if (!targetPath) {
      return res.status(404).json({ 
        success: false, 
        message: `Path not found` 
      });
    }
    
    targetPath.status = 'in_progress';
    targetPath.lastAccessedAt = new Date();
    learningPath.currentPathId = targetPath._id;
    
    await learningPath.save();
    
    const formattedMilestones = (targetPath.milestones || []).map((milestone, index) => ({
      step: index + 1,
      _id: milestone._id,
      title: milestone.title,
      topic: milestone.title,
      status: milestone.status === "completed" ? "Completed" : 
              milestone.status === "available" || milestone.status === "in_progress" ? "In Progress" : "Locked",
      duration: `${milestone.estimatedTime || 60} min`,
      description: milestone.description || `Master ${milestone.title}`,
      skills: milestone.topics?.flatMap(t => t.skills) || milestone.skills || [],
      progress: milestone.progress || 0,
      topics: (milestone.topics || []).map(topic => ({
        _id: topic._id,
        title: topic.title,
        description: topic.description,
        status: topic.status || 'pending',
        estimatedTime: topic.estimatedTime || 60,
        skills: topic.skills || [],
        completedAt: topic.completedAt,
        timeSpent: topic.timeSpent || 0
      })),
      resources: milestone.resources || [],
      order: milestone.order,
      completedAt: milestone.completedAt,
      estimatedTime: milestone.estimatedTime,
      milestoneId: milestone._id
    }));
    
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-resumed', {
        goal: targetPath.goal,
        pathId: targetPath._id,
        progress: targetPath.progress,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Learning path resumed successfully',
      data: {
        goal: targetPath.goal,
        description: targetPath.description,
        milestones: formattedMilestones,
        totalProgress: targetPath.progress || 0,
        hasLearningPath: true
      }
    });
    
  } catch (error) {
    console.error('❌ Resume path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error resuming learning path',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Archive current path
export const archiveCurrentPath = async (req, res) => {
  try {
    const studentId = req.user.id;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No learning path found' 
      });
    }
    
    const currentPath = learningPath.paths.find(p => p._id.toString() === learningPath.currentPathId?.toString());
    
    if (!currentPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active learning path to archive' 
      });
    }
    
    currentPath.status = 'completed';
    currentPath.completedAt = new Date();
    learningPath.currentPathId = null;
    await learningPath.save();
    
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-archived', {
        goal: currentPath.goal,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Learning path archived successfully'
    });
    
  } catch (error) {
    console.error('Archive path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error archiving learning path' 
    });
  }
};

// @desc    Delete a path
export const deletePath = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { pathId } = req.params;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No learning path found' 
      });
    }
    
    const pathIndex = learningPath.paths.findIndex(p => p._id.toString() === pathId);
    
    if (pathIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: 'Path not found' 
      });
    }
    
    if (learningPath.currentPathId?.toString() === pathId) {
      learningPath.currentPathId = null;
    }
    
    learningPath.paths.splice(pathIndex, 1);
    await learningPath.save();
    
    const io = req.app.locals.io;
    if (io) {
      io.to(`user:${studentId}`).emit('learning-path-deleted', {
        pathId,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Learning path deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting learning path' 
    });
  }
};

// @desc    Get milestone for review
export const getMilestoneForReview = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { milestoneId } = req.params;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'Learning path not found' 
      });
    }
    
    let milestone = null;
    let sourcePath = null;
    
    for (const path of learningPath.paths) {
      const found = path.milestones.find(m => m._id.toString() === milestoneId);
      if (found) {
        milestone = found;
        sourcePath = path;
        break;
      }
    }
    
    if (!milestone) {
      return res.status(404).json({ 
        success: false, 
        message: 'Milestone not found' 
      });
    }
    
    const totalTopics = milestone.topics?.length || 0;
    const completedTopics = milestone.topics?.filter(t => t.status === 'completed').length || 0;
    const completionPercentage = totalTopics > 0 ? (completedTopics / totalTopics) * 100 : 0;
    
    res.json({
      success: true,
      data: {
        milestoneId: milestone._id,
        title: milestone.title,
        description: milestone.description,
        status: milestone.status,
        progress: milestone.progress || completionPercentage,
        completedAt: milestone.completedAt,
        topics: (milestone.topics || []).map(topic => ({
          id: topic._id,
          title: topic.title,
          description: topic.description,
          status: topic.status,
          completedAt: topic.completedAt,
          timeSpent: topic.timeSpent || 0,
          estimatedTime: topic.estimatedTime || 60,
          skills: topic.skills || []
        })),
        quizzes: milestone.quizzes || [],
        projects: milestone.projects || [],
        pathGoal: sourcePath.goal,
        stats: {
          totalTopics,
          completedTopics,
          completionPercentage: Math.round(completionPercentage)
        }
      }
    });
    
  } catch (error) {
    console.error('Get milestone for review error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching milestone data' 
    });
  }
};

// @desc    Update learning path progress (legacy)
export const updateLearningPathProgress = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { topicId, milestoneId, completed } = req.body;
    
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'Learning path not found' 
      });
    }
    
    const currentPath = learningPath.paths.find(p => p._id.toString() === learningPath.currentPathId?.toString());
    
    if (!currentPath) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active learning path' 
      });
    }
    
    if (milestoneId && completed) {
      const milestone = currentPath.milestones.find(m => m._id.toString() === milestoneId);
      if (milestone && milestone.status !== 'completed') {
        milestone.status = 'completed';
        milestone.completedAt = new Date();
      }
    }
    
    let totalTopics = 0;
    let completedTopics = 0;
    
    currentPath.milestones.forEach(milestone => {
      if (milestone.topics) {
        milestone.topics.forEach(topic => {
          totalTopics++;
          if (topic.status === 'completed') completedTopics++;
        });
      }
    });
    
    currentPath.progress = totalTopics > 0 ? (completedTopics / totalTopics) * 100 : 0;
    await learningPath.save();
    
    res.json({
      success: true,
      message: 'Learning path progress updated',
      data: { 
        progress: currentPath.progress, 
        completedTopics, 
        totalTopics 
      }
    });
    
  } catch (error) {
    console.error('Update learning path error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating learning path' 
    });
  }
};

// @desc    Get completed paths (legacy)
export const getCompletedPaths = async (req, res) => {
  try {
    const studentId = req.user.id;
    const learningPath = await LearningPath.findOne({ studentId });
    
    if (!learningPath || !learningPath.paths || learningPath.paths.length === 0) {
      return res.json({ success: true, data: [] });
    }
    
    const completedPaths = learningPath.paths.filter(p => p.status === 'completed');
    
    const formattedPaths = completedPaths.map(path => ({
      _id: path._id,
      goal: path.goal,
      title: path.goal,
      description: path.description,
      difficulty: path.difficulty,
      progress: path.progress || 0,
      startedAt: path.startedAt,
      completedAt: path.completedAt,
      milestonesCompleted: path.milestones?.filter(m => m.status === 'completed').length || 0,
      milestones: path.milestones || []
    }));
    
    res.json({ success: true, data: formattedPaths });
    
  } catch (error) {
    console.error('Get completed paths error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching completed paths' 
    });
  }
};