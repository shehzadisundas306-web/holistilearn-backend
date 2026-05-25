/**
 * Quiz History Model
 * Tracks student quiz attempts, performance analytics, and learning patterns.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const quizHistorySchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  attempts: [{
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true
    },
    topic: {
      type: String,
      required: true
    },
    title: String,
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    totalQuestions: {
      type: Number,
      required: true,
      min: 1
    },
    correctAnswers: {
      type: Number,
      required: true,
      min: 0
    },
    incorrectAnswers: {
      type: Number,
      default: 0
    },
    skippedQuestions: {
      type: Number,
      default: 0
    },
    timeSpent: {
      type: Number, // in seconds
      required: true,
      min: 0
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      required: true
    },
    questions: [{
      questionId: String,
      question: String,
      userAnswer: String,
      correctAnswer: String,
      isCorrect: Boolean,
      timeSpent: Number, // seconds spent on this question
      options: [String],
      explanation: String,
      category: String,
      difficulty: String
    }],
    strengths: [{
      topic: String,
      percentage: Number
    }],
    weaknesses: [{
      topic: String,
      percentage: Number
    }],
    mentalStateAtTime: {
      stressLevel: String,
      motivationLevel: String,
      energyLevel: String,
      focusLevel: String,
      mood: String
    },
    completedAt: {
      type: Date,
      default: Date.now
    },
    feedback: {
      rating: {
        type: Number,
        min: 1,
        max: 5
      },
      comment: String,
      difficultyRating: {
        type: Number,
        min: 1,
        max: 5
      }
    }
  }],
  statistics: {
    totalQuizzes: {
      type: Number,
      default: 0
    },
    totalQuestions: {
      type: Number,
      default: 0
    },
    totalCorrect: {
      type: Number,
      default: 0
    },
    totalIncorrect: {
      type: Number,
      default: 0
    },
    totalSkipped: {
      type: Number,
      default: 0
    },
    totalTimeSpent: {
      type: Number,
      default: 0 // in seconds
    },
    averageScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    bestScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    worstScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100
    },
    averageTimePerQuiz: {
      type: Number,
      default: 0 // in seconds
    },
    topicsMastered: [{
      topic: String,
      averageScore: Number,
      attemptsCount: Number,
      lastAttempted: Date
    }],
    weakTopics: [{
      topic: String,
      averageScore: Number,
      attemptsCount: Number,
      lastAttempted: Date
    }],
    categoryPerformance: [{
      category: String,
      averageScore: Number,
      totalQuestions: Number,
      correctPercentage: Number
    }],
    difficultyPerformance: {
      beginner: {
        averageScore: Number,
        totalAttempts: Number
      },
      intermediate: {
        averageScore: Number,
        totalAttempts: Number
      },
      advanced: {
        averageScore: Number,
        totalAttempts: Number
      }
    },
    streakByTopic: [{
      topic: String,
      currentStreak: Number,
      bestStreak: Number
    }]
  },
  recommendations: {
    suggestedTopics: [{
      topic: String,
      reason: String,
      priority: {
        type: String,
        enum: ['high', 'medium', 'low']
      }
    }],
    suggestedDifficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced']
    },
    practiceAreas: [String],
    nextReviewDate: Date
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// ============= INSTANCE METHODS =============

/**
 * Update statistics after new attempt
 * @param {Object} newAttempt - The new quiz attempt
 */
quizHistorySchema.methods.updateStatistics = function(newAttempt) {
  const stats = this.statistics;
  const attempt = newAttempt;
  
  // Update totals
  stats.totalQuizzes += 1;
  stats.totalQuestions += attempt.totalQuestions;
  stats.totalCorrect += attempt.correctAnswers;
  stats.totalIncorrect += attempt.incorrectAnswers || 0;
  stats.totalSkipped += attempt.skippedQuestions || 0;
  stats.totalTimeSpent += attempt.timeSpent;
  
  // Update averages
  stats.averageScore = (stats.averageScore * (stats.totalQuizzes - 1) + attempt.score) / stats.totalQuizzes;
  stats.averageTimePerQuiz = (stats.averageTimePerQuiz * (stats.totalQuizzes - 1) + attempt.timeSpent) / stats.totalQuizzes;
  
  // Update best/worst scores
  if (attempt.score > stats.bestScore) {
    stats.bestScore = attempt.score;
  }
  if (attempt.score < stats.worstScore) {
    stats.worstScore = attempt.score;
  }
  
  // Update topic performance
  this.updateTopicPerformance(attempt);
  
  // Update category performance
  this.updateCategoryPerformance(attempt);
  
  // Update difficulty performance
  this.updateDifficultyPerformance(attempt);
  
  // Update weak topics and mastered topics
  this.identifyWeakAndMasteredTopics();
  
  // Generate recommendations
  this.generateRecommendations();
  
  this.lastUpdated = new Date();
};

/**
 * Update topic performance based on attempt
 * @param {Object} attempt - Quiz attempt
 */
quizHistorySchema.methods.updateTopicPerformance = function(attempt) {
  const topic = attempt.topic;
  
  // Find or create topic entry in mastered/weak topics
  let masteredTopic = this.statistics.topicsMastered.find(t => t.topic === topic);
  let weakTopic = this.statistics.weakTopics.find(t => t.topic === topic);
  
  if (!masteredTopic && !weakTopic) {
    // New topic
    if (attempt.score >= 80) {
      this.statistics.topicsMastered.push({
        topic,
        averageScore: attempt.score,
        attemptsCount: 1,
        lastAttempted: new Date()
      });
    } else {
      this.statistics.weakTopics.push({
        topic,
        averageScore: attempt.score,
        attemptsCount: 1,
        lastAttempted: new Date()
      });
    }
  } else if (masteredTopic) {
    // Update existing mastered topic
    masteredTopic.averageScore = (masteredTopic.averageScore * masteredTopic.attemptsCount + attempt.score) / (masteredTopic.attemptsCount + 1);
    masteredTopic.attemptsCount += 1;
    masteredTopic.lastAttempted = new Date();
    
    // If score drops below 70, move to weak topics
    if (attempt.score < 70) {
      this.statistics.weakTopics.push({
        topic,
        averageScore: masteredTopic.averageScore,
        attemptsCount: masteredTopic.attemptsCount,
        lastAttempted: masteredTopic.lastAttempted
      });
      this.statistics.topicsMastered = this.statistics.topicsMastered.filter(t => t.topic !== topic);
    }
  } else if (weakTopic) {
    // Update existing weak topic
    weakTopic.averageScore = (weakTopic.averageScore * weakTopic.attemptsCount + attempt.score) / (weakTopic.attemptsCount + 1);
    weakTopic.attemptsCount += 1;
    weakTopic.lastAttempted = new Date();
    
    // If score improves above 80, move to mastered topics
    if (attempt.score >= 80) {
      this.statistics.topicsMastered.push({
        topic,
        averageScore: weakTopic.averageScore,
        attemptsCount: weakTopic.attemptsCount,
        lastAttempted: weakTopic.lastAttempted
      });
      this.statistics.weakTopics = this.statistics.weakTopics.filter(t => t.topic !== topic);
    }
  }
};

/**
 * Update category performance based on attempt
 * @param {Object} attempt - Quiz attempt
 */
quizHistorySchema.methods.updateCategoryPerformance = function(attempt) {
  attempt.questions.forEach(q => {
    if (q.category) {
      let categoryPerf = this.statistics.categoryPerformance.find(c => c.category === q.category);
      
      if (!categoryPerf) {
        categoryPerf = {
          category: q.category,
          averageScore: 0,
          totalQuestions: 0,
          correctPercentage: 0
        };
        this.statistics.categoryPerformance.push(categoryPerf);
      }
      
      categoryPerf.totalQuestions += 1;
      if (q.isCorrect) {
        categoryPerf.correctPercentage = (categoryPerf.correctPercentage * (categoryPerf.totalQuestions - 1) + 100) / categoryPerf.totalQuestions;
      } else {
        categoryPerf.correctPercentage = (categoryPerf.correctPercentage * (categoryPerf.totalQuestions - 1)) / categoryPerf.totalQuestions;
      }
      categoryPerf.averageScore = categoryPerf.correctPercentage;
    }
  });
};

/**
 * Update difficulty performance based on attempt
 * @param {Object} attempt - Quiz attempt
 */
quizHistorySchema.methods.updateDifficultyPerformance = function(attempt) {
  const difficulty = attempt.difficulty;
  const perf = this.statistics.difficultyPerformance[difficulty];
  
  if (perf) {
    perf.averageScore = (perf.averageScore * perf.totalAttempts + attempt.score) / (perf.totalAttempts + 1);
    perf.totalAttempts += 1;
  } else {
    this.statistics.difficultyPerformance[difficulty] = {
      averageScore: attempt.score,
      totalAttempts: 1
    };
  }
};

/**
 * Identify weak and mastered topics
 */
quizHistorySchema.methods.identifyWeakAndMasteredTopics = function() {
  const allTopics = [...this.statistics.topicsMastered, ...this.statistics.weakTopics];
  
  // Sort by average score
  allTopics.sort((a, b) => b.averageScore - a.averageScore);
  
  // Top 25% are mastered, bottom 25% are weak
  const thresholdIndex = Math.floor(allTopics.length * 0.25);
  
  this.statistics.topicsMastered = allTopics.slice(0, thresholdIndex).map(t => ({
    ...t,
    status: 'mastered'
  }));
  
  this.statistics.weakTopics = allTopics.slice(-thresholdIndex).map(t => ({
    ...t,
    status: 'weak'
  }));
};

/**
 * Generate recommendations based on performance
 */
quizHistorySchema.methods.generateRecommendations = function() {
  const recommendations = {
    suggestedTopics: [],
    suggestedDifficulty: 'intermediate',
    practiceAreas: [],
    nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 1 week from now
  };
  
  // Suggest weak topics for review
  this.statistics.weakTopics.forEach(topic => {
    recommendations.suggestedTopics.push({
      topic: topic.topic,
      reason: `You need more practice in ${topic.topic}. Your average score is ${topic.averageScore.toFixed(1)}%.`,
      priority: 'high'
    });
  });
  
  // Suggest difficulty level based on performance
  const difficultyPerf = this.statistics.difficultyPerformance;
  if (difficultyPerf.advanced?.averageScore > 80) {
    recommendations.suggestedDifficulty = 'advanced';
  } else if (difficultyPerf.intermediate?.averageScore > 70) {
    recommendations.suggestedDifficulty = 'intermediate';
  } else {
    recommendations.suggestedDifficulty = 'beginner';
  }
  
  // Identify practice areas from incorrect answers
  const incorrectCategories = this.statistics.categoryPerformance
    .filter(c => c.correctPercentage < 60)
    .map(c => c.category);
  
  recommendations.practiceAreas = incorrectCategories;
  
  this.recommendations = recommendations;
};

/**
 * Get performance trend over time
 * @param {number} days - Number of days to look back
 * @returns {Array} Performance trend data
 */
quizHistorySchema.methods.getPerformanceTrend = function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const recentAttempts = this.attempts.filter(a => a.completedAt >= cutoffDate);
  
  // Group by day
  const dailyPerformance = {};
  recentAttempts.forEach(attempt => {
    const date = attempt.completedAt.toDateString();
    if (!dailyPerformance[date]) {
      dailyPerformance[date] = {
        date: attempt.completedAt,
        scores: [],
        averageScore: 0
      };
    }
    dailyPerformance[date].scores.push(attempt.score);
    dailyPerformance[date].averageScore = 
      dailyPerformance[date].scores.reduce((a, b) => a + b, 0) / dailyPerformance[date].scores.length;
  });
  
  return Object.values(dailyPerformance).sort((a, b) => a.date - b.date);
};

/**
 * Get mastery level for a specific topic
 * @param {string} topic - Topic name
 * @returns {Object} Mastery information
 */
quizHistorySchema.methods.getTopicMastery = function(topic) {
  const mastered = this.statistics.topicsMastered.find(t => t.topic === topic);
  const weak = this.statistics.weakTopics.find(t => t.topic === topic);
  
  if (mastered) {
    return {
      level: 'mastered',
      score: mastered.averageScore,
      attempts: mastered.attemptsCount
    };
  } else if (weak) {
    return {
      level: 'weak',
      score: weak.averageScore,
      attempts: weak.attemptsCount
    };
  } else {
    return {
      level: 'untested',
      score: 0,
      attempts: 0
    };
  }
};

/**
 * Get next recommended quiz
 * @returns {Object} Recommended quiz info
 */
quizHistorySchema.methods.getNextRecommendedQuiz = function() {
  // Find weakest topic that hasn't been attempted recently
  const weakTopics = this.statistics.weakTopics
    .sort((a, b) => a.averageScore - b.averageScore);
  
  if (weakTopics.length > 0) {
    return {
      topic: weakTopics[0].topic,
      difficulty: this.recommendations.suggestedDifficulty,
      reason: `You need to improve your score in ${weakTopics[0].topic}`
    };
  }
  
  // If no weak topics, recommend a random topic at appropriate difficulty
  return {
    topic: 'Review',
    difficulty: this.recommendations.suggestedDifficulty,
    reason: 'Time for a comprehensive review'
  };
};

/**
 * Get study tips based on mistakes
 * @returns {Array} Study tips
 */
quizHistorySchema.methods.getStudyTips = function() {
  const tips = [];
  const lastAttempt = this.attempts[this.attempts.length - 1];
  
  if (lastAttempt) {
    const commonMistakes = lastAttempt.questions
      .filter(q => !q.isCorrect)
      .slice(0, 3);
    
    commonMistakes.forEach(mistake => {
      tips.push({
        topic: mistake.category || 'General',
        tip: `Review: ${mistake.question.substring(0, 50)}...`,
        explanation: mistake.explanation
      });
    });
  }
  
  return tips;
};

/**
 * Add a new quiz attempt
 * @param {Object} attemptData - The attempt data
 */
quizHistorySchema.methods.addAttempt = function(attemptData) {
  this.attempts.push(attemptData);
  this.updateStatistics(attemptData);
};

/**
 * Get recent attempts
 * @param {number} limit - Number of attempts to return
 * @returns {Array} Recent attempts
 */
quizHistorySchema.methods.getRecentAttempts = function(limit = 5) {
  return this.attempts
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, limit);
};

/**
 * Get attempts for a specific quiz
 * @param {string} quizId - Quiz ID
 * @returns {Array} Quiz attempts
 */
quizHistorySchema.methods.getQuizAttempts = function(quizId) {
  return this.attempts.filter(a => a.quizId.toString() === quizId);
};

/**
 * Calculate average score for a specific topic
 * @param {string} topic - Topic name
 * @returns {number} Average score
 */
quizHistorySchema.methods.getTopicAverageScore = function(topic) {
  const topicAttempts = this.attempts.filter(a => a.topic === topic);
  if (topicAttempts.length === 0) return 0;
  
  const totalScore = topicAttempts.reduce((sum, a) => sum + a.score, 0);
  return totalScore / topicAttempts.length;
};

// ============= STATIC METHODS =============

/**
 * Find or create quiz history for a student
 * @param {string} studentId - Student ID
 * @returns {Promise<Object>} Quiz history document
 */
quizHistorySchema.statics.findOrCreate = async function(studentId) {
  let quizHistory = await this.findOne({ studentId });
  if (!quizHistory) {
    quizHistory = new this({ studentId });
    await quizHistory.save();
  }
  return quizHistory;
};

/**
 * Get leaderboard for a specific topic
 * @param {string} topic - Topic name
 * @param {number} limit - Number of students to return
 * @returns {Promise<Array>} Leaderboard data
 */
quizHistorySchema.statics.getTopicLeaderboard = async function(topic, limit = 10) {
  return this.aggregate([
    { $unwind: '$attempts' },
    { $match: { 'attempts.topic': topic } },
    { $group: {
      _id: '$studentId',
      bestScore: { $max: '$attempts.score' },
      averageScore: { $avg: '$attempts.score' },
      attemptsCount: { $sum: 1 }
    }},
    { $sort: { bestScore: -1 } },
    { $limit: limit },
    { $lookup: {
      from: 'users',
      localField: '_id',
      foreignField: '_id',
      as: 'user'
    }},
    { $unwind: '$user' },
    { $project: {
      studentId: '$_id',
      name: '$user.name',
      bestScore: 1,
      averageScore: 1,
      attemptsCount: 1
    }}
  ]);
};

// ============= INDEXES =============
// quizHistorySchema.index({ studentId: 1, 'attempts.completedAt': -1 });
quizHistorySchema.index({ 'statistics.weakTopics.topic': 1 });
quizHistorySchema.index({ 'statistics.topicsMastered.topic': 1 });

const QuizHistory = mongoose.model('QuizHistory', quizHistorySchema);
export default QuizHistory;