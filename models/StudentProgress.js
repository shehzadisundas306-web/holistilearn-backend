/**
 * Student Progress Model
 * Tracks gamification metrics (XP, Levels), learning streaks, 
 * and detailed per-topic progress.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const studentProgressSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  stats: {
    completedLessons: {
      type: Number,
      default: 0,
      min: 0
    },
    quizzesTaken: {
      type: Number,
      default: 0,
      min: 0
    },
    averageScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    totalStudyTime: {
      type: Number,
      default: 0, // in minutes
      min: 0
    },
    learningStreak: {
      type: Number,
      default: 0,
      min: 0
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    xpPoints: {
      type: Number,
      default: 0,
      min: 0
    },
    level: {
      type: Number,
      default: 1,
      min: 1
    },
    totalTopics: {
      type: Number,
      default: 0
    },
    completedTopics: {
      type: Number,
      default: 0
    }
  },
  topicsProgress: [{
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      required: true
    },
    status: {
      type: String,
      enum: Object.values(constants.PROGRESS_STATUS),
      default: constants.PROGRESS_STATUS.NOT_STARTED
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    startedAt: Date,
    completedAt: Date,
    lastAccessed: {
      type: Date,
      default: Date.now
    },
    timeSpent: {
      type: Number,
      default: 0 // in minutes
    },
    completedLessons: [{
      lessonId: String,
      completedAt: Date,
      timeSpent: Number
    }],
    quizAttempts: [{
      quizId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz'
      },
      score: Number,
      passed: Boolean,
      attemptedAt: Date
    }],
    notes: [{
      noteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AINotes'
      },
      viewedAt: Date
    }]
  }],
  achievements: [{
    achievementId: String,
    name: String,
    description: String,
    earnedAt: {
      type: Date,
      default: Date.now
    },
    icon: String,
    xpReward: Number
  }],
  weeklyActivity: [{
    week: {
      year: Number,
      week: Number
    },
    days: [{
      date: Date,
      studyTime: Number,
      quizzesTaken: Number,
      topicsCompleted: Number,
      xpEarned: Number
    }],
    totalStudyTime: Number,
    totalXpEarned: Number
  }],
  streakHistory: [{
    date: Date,
    studied: Boolean,
    reason: String
  }],
  lastStreakUpdate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// --- Schema Methods ---

/**
 * Calculates student level based on XP.
 * Standard logic: 100 XP per level.
 */
studentProgressSchema.methods.calculateLevel = function() {
  const xpPerLevel = 100;
  this.stats.level = Math.floor(this.stats.xpPoints / xpPerLevel) + 1;
  return this.stats.level;
};

/**
 * Adds XP and handles level-up logic/notifications.
 */
studentProgressSchema.methods.addXP = function(amount) {
  this.stats.xpPoints += amount;
  const oldLevel = this.stats.level;
  const newLevel = this.calculateLevel();
  
  if (newLevel > oldLevel) {
    this.achievements.push({
      achievementId: `level_${newLevel}`,
      name: `Reached Level ${newLevel}`,
      description: `Congratulations! You've reached level ${newLevel}!`,
      icon: '⭐',
      xpReward: 0
    });
  }
  
  return newLevel > oldLevel;
};

/**
 * Logic for maintaining, breaking, or freezing learning streaks.
 */
studentProgressSchema.methods.updateStreak = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const lastActive = new Date(this.stats.lastActive);
  lastActive.setHours(0, 0, 0, 0);
  
  const dayDiff = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));
  
  if (dayDiff === 1) {
    // Consecutive day
    this.stats.learningStreak += 1;
    this.streakHistory.push({
      date: today,
      studied: true,
      reason: 'streak_continued'
    });
    
    // Milestones
    if (this.stats.learningStreak === 7) {
      this.achievements.push({
        achievementId: 'seven_day_streak',
        name: 'Week Warrior',
        description: 'Maintained a 7-day learning streak',
        icon: '🔥',
        xpReward: 200
      });
      this.addXP(200);
    } else if (this.stats.learningStreak === 30) {
      this.achievements.push({
        achievementId: 'thirty_day_streak',
        name: 'Monthly Master',
        description: 'Maintained a 30-day learning streak',
        icon: '🌟',
        xpReward: 500
      });
      this.addXP(500);
    }
  } else if (dayDiff === 0) {
    this.streakHistory.push({
      date: today,
      studied: true,
      reason: 'multiple_sessions'
    });
  } else if (dayDiff > 1 && dayDiff <= (constants.STREAK?.FREEZE_DAYS || 2) + 1) {
    this.streakHistory.push({
      date: today,
      studied: true,
      reason: 'streak_frozen'
    });
  } else if (dayDiff > (constants.STREAK?.FREEZE_DAYS || 2) + 1) {
    // Streak broken
    this.stats.learningStreak = 1;
    this.streakHistory.push({
      date: today,
      studied: true,
      reason: 'streak_reset'
    });
  }
  
  this.stats.lastActive = new Date();
};

/**
 * Updates the weekly aggregate activity data.
 */
studentProgressSchema.methods.updateWeeklyActivity = function(studyTime, xpEarned) {
  const now = new Date();
  const weekNumber = this.getWeekNumber(now);
  const year = now.getFullYear();
  
  let weekData = this.weeklyActivity.find(
    w => w.week.year === year && w.week.week === weekNumber
  );
  
  if (!weekData) {
    weekData = {
      week: { year, week: weekNumber },
      days: [],
      totalStudyTime: 0,
      totalXpEarned: 0
    };
    this.weeklyActivity.push(weekData);
  }
  
  let todayEntry = weekData.days.find(day => 
    day.date.toDateString() === now.toDateString()
  );
  
  if (!todayEntry) {
    todayEntry = {
      date: now,
      studyTime: 0,
      quizzesTaken: 0,
      topicsCompleted: 0,
      xpEarned: 0
    };
    weekData.days.push(todayEntry);
  }
  
  todayEntry.studyTime += studyTime;
  todayEntry.xpEarned += xpEarned;
  weekData.totalStudyTime += studyTime;
  weekData.totalXpEarned += xpEarned;
  
  if (this.weeklyActivity.length > 12) {
    this.weeklyActivity = this.weeklyActivity.slice(-12);
  }
};

/**
 * ISO Week calculation helper.
 */
studentProgressSchema.methods.getWeekNumber = function(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

studentProgressSchema.methods.getTopicProgress = function(topicId) {
  return this.topicsProgress.find(
    tp => tp.topicId.toString() === topicId.toString()
  );
};

/**
 * Updates or initializes progress for a specific topic.
 */
studentProgressSchema.methods.updateTopicProgress = function(topicId, updateData) {
  let topicProgress = this.getTopicProgress(topicId);
  
  if (!topicProgress) {
    topicProgress = {
      topicId,
      status: constants.PROGRESS_STATUS.IN_PROGRESS,
      startedAt: new Date(),
      progress: 0,
      completedLessons: [],
      quizAttempts: [],
      notes: []
    };
    this.topicsProgress.push(topicProgress);
    this.stats.totalTopics += 1;
  }
  
  Object.assign(topicProgress, updateData);
  topicProgress.lastAccessed = new Date();
  
  if (topicProgress.progress >= 100 && topicProgress.status !== constants.PROGRESS_STATUS.COMPLETED) {
    topicProgress.status = constants.PROGRESS_STATUS.COMPLETED;
    topicProgress.completedAt = new Date();
    this.stats.completedTopics += 1;
    this.stats.completedLessons += 1;
    this.addXP(50); 
  }
  
  return topicProgress;
};

studentProgressSchema.methods.getOverallProgress = function() {
  if (this.stats.totalTopics === 0) return 0;
  return (this.stats.completedTopics / this.stats.totalTopics) * 100;
};

studentProgressSchema.methods.getRecentAchievements = function(limit = 5) {
  return this.achievements
    .sort((a, b) => b.earnedAt - a.earnedAt)
    .slice(0, limit);
};

studentProgressSchema.methods.getTodayStudyTime = function() {
  const today = new Date().toDateString();
  const weekData = this.weeklyActivity[this.weeklyActivity.length - 1];
  
  if (weekData) {
    const todayEntry = weekData.days.find(day => 
      day.date.toDateString() === today
    );
    return todayEntry?.studyTime || 0;
  }
  
  return 0;
};

studentProgressSchema.methods.getWeeklyStudyTime = function() {
  const currentWeek = this.weeklyActivity[this.weeklyActivity.length - 1];
  return currentWeek?.totalStudyTime || 0;
};

studentProgressSchema.index({ 'topicsProgress.topicId': 1 });
studentProgressSchema.index({ 'achievements.earnedAt': -1 });

const StudentProgress = mongoose.model('StudentProgress', studentProgressSchema);
export default StudentProgress;