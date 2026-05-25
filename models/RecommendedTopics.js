/**
 * Recommended Topics Model
 * Manages personalized learning content suggestions using hybrid recommendation logic.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const recommendedTopicsSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  recommendations: [{
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic'
    },
    title: {
      type: String,
      required: true
    },
    description: String,
    category: {
      type: String,
      enum: constants.TOPIC_CATEGORIES
    },
    difficulty: {
      type: String,
      enum: constants.DIFFICULTY_LEVELS
    },
    estimatedTime: Number, // in minutes
    prerequisites: [String],
    skills: [String],
    
    // Logic for recommendation
    reason: {
      type: {
        type: String,
        enum: ['interest', 'weakness', 'prerequisite', 'trending', 'career', 'skill_gap']
      },
      description: String,
      score: {
        type: Number,
        min: 0,
        max: 100
      }
    },
    
    relevanceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    
    basedOn: {
      quizPerformance: Boolean,
      searchHistory: Boolean,
      mentalState: Boolean,
      careerGoals: Boolean,
      completedTopics: Boolean,
      timeAvailable: Boolean
    },
    
    preview: {
      shortDescription: String,
      keyPoints: [String],
      thumbnail: String,
      popularity: {
        type: Number,
        min: 0,
        max: 100
      }
    },
    
    relatedTopics: [{
      title: String,
      relation: String
    }],
    
    resources: [{
      title: String,
      type: {
        type: String,
        enum: ['video', 'article', 'course', 'book', 'documentation']
      },
      url: String,
      duration: Number,
      isFree: {
        type: Boolean,
        default: true
      }
    }],
    
    status: {
      type: String,
      enum: ['recommended', 'viewed', 'started', 'completed', 'dismissed'],
      default: 'recommended'
    },
    viewedAt: Date,
    startedAt: Date,
    completedAt: Date,
    expiresAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  categories: {
    trending: [{
      topicId: mongoose.Schema.Types.ObjectId,
      title: String,
      popularity: Number
    }],
    forYou: [{
      topicId: mongoose.Schema.Types.ObjectId,
      title: String,
      score: Number
    }],
    basedOnHistory: [{
      topicId: mongoose.Schema.Types.ObjectId,
      title: String,
      reason: String
    }],
    skillBased: [{
      skill: String,
      topics: [String]
    }]
  },
  
  feedback: [{
    topicId: mongoose.Schema.Types.ObjectId,
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    relevance: {
      type: String,
      enum: ['very_relevant', 'somewhat_relevant', 'not_relevant']
    },
    tookAction: {
      type: String,
      enum: ['viewed', 'started', 'completed', 'dismissed']
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  lastGenerated: {
    type: Date,
    default: Date.now
  },
  
  generationMetadata: {
    method: {
      type: String,
      enum: ['ai', 'collaborative', 'content_based', 'hybrid'],
      default: 'hybrid'
    },
    userDataPoints: Number,
    processingTime: Number,
    confidence: {
      type: Number,
      min: 0,
      max: 100
    }
  }
}, {
  timestamps: true
});

// --- Methods ---

// Add new recommendations and prune to top 50
recommendedTopicsSchema.methods.addRecommendations = function(recommendations) {
  recommendations.forEach(rec => {
    const exists = this.recommendations.some(
      r => r.topicId?.toString() === rec.topicId?.toString()
    );
    
    if (!exists) {
      this.recommendations.push({
        ...rec,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days expiry
      });
    }
  });
  
  this.recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  if (this.recommendations.length > 50) {
    this.recommendations = this.recommendations.slice(0, 50);
  }
};

// Get current active recommendations
recommendedTopicsSchema.methods.getActiveRecommendations = function(limit = 10) {
  const now = new Date();
  return this.recommendations
    .filter(r => 
      r.status === 'recommended' && 
      (!r.expiresAt || r.expiresAt > now)
    )
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
};

// Filter recommendations by category
recommendedTopicsSchema.methods.getRecommendationsByCategory = function(category, limit = 5) {
  const now = new Date();
  return this.recommendations
    .filter(r => 
      r.category === category &&
      r.status === 'recommended' &&
      (!r.expiresAt || r.expiresAt > now)
    )
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
};

// Update recommendation interaction status
recommendedTopicsSchema.methods.updateStatus = function(topicId, status) {
  const recommendation = this.recommendations.find(
    r => r.topicId?.toString() === topicId.toString()
  );
  
  if (recommendation) {
    recommendation.status = status;
    
    if (status === 'viewed') recommendation.viewedAt = new Date();
    if (status === 'started') recommendation.startedAt = new Date();
    if (status === 'completed') recommendation.completedAt = new Date();
    
    this.feedback.push({
      topicId,
      tookAction: status,
      timestamp: new Date()
    });
  }
};

// Log user feedback and adjust scoring
recommendedTopicsSchema.methods.addFeedback = function(topicId, rating, relevance) {
  const recommendation = this.recommendations.find(
    r => r.topicId?.toString() === topicId.toString()
  );
  
  if (recommendation) {
    this.feedback.push({
      topicId,
      rating,
      relevance,
      timestamp: new Date()
    });
    
    this.adjustRelevanceBasedOnFeedback(recommendation, rating, relevance);
  }
};

// Internal helper for reinforcement learning logic
recommendedTopicsSchema.methods.adjustRelevanceBasedOnFeedback = function(recommendation, rating, relevance) {
  let adjustment = 0;
  
  if (rating >= 4) adjustment = 10;
  else if (rating <= 2) adjustment = -10;
  
  if (relevance === 'very_relevant') adjustment += 5;
  else if (relevance === 'not_relevant') adjustment -= 5;
  
  recommendation.relevanceScore = Math.max(0, Math.min(100, 
    recommendation.relevanceScore + adjustment
  ));
};

// Populate trending category from global data
recommendedTopicsSchema.methods.generateTrending = function(globalTrends) {
  this.categories.trending = globalTrends.slice(0, 10).map(trend => ({
    topicId: trend.topicId,
    title: trend.title,
    popularity: trend.popularity
  }));
};

// Populate "For You" based on profile preferences
recommendedTopicsSchema.methods.generateForYou = function(userPreferences) {
  let forYou = [];
  
  if (userPreferences.interests) {
    userPreferences.interests.forEach(interest => {
      const matchingTopics = this.recommendations
        .filter(r => r.category === interest || r.skills.includes(interest))
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 3);
      
      forYou.push(...matchingTopics);
    });
  }
  
  this.categories.forYou = forYou.slice(0, 10).map(t => ({
    topicId: t.topicId,
    title: t.title,
    score: t.relevanceScore
  }));
};

// Recommendation logic based on quiz gaps
recommendedTopicsSchema.methods.generateBasedOnHistory = function(quizHistory, completedTopics) {
  const basedOnHistory = [];
  
  if (quizHistory?.statistics?.weakTopics) {
    quizHistory.statistics.weakTopics.forEach(weakTopic => {
      basedOnHistory.push({
        topicId: weakTopic.topicId,
        title: weakTopic.topic,
        reason: 'Based on your quiz performance - this needs more practice'
      });
    });
  }
  
  this.categories.basedOnHistory = basedOnHistory.slice(0, 10);
};

// Logical progression sequencing
recommendedTopicsSchema.methods.getNextLogicalTopic = function(completedTopics) {
  const availableTopics = this.recommendations.filter(topic => {
    if (!topic.prerequisites || topic.prerequisites.length === 0) return true;
    return topic.prerequisites.every(prereq => completedTopics.includes(prereq));
  });
  
  return availableTopics.sort((a, b) => b.relevanceScore - a.relevanceScore)[0];
};

// Filter by session time availability
recommendedTopicsSchema.methods.getRecommendationsByTime = function(timeAvailable) {
  return this.getActiveRecommendations()
    .filter(r => r.estimatedTime <= timeAvailable)
    .slice(0, 5);
};

// Mental-state aware filtering
recommendedTopicsSchema.methods.getRecommendationsByMentalState = function(mentalState) {
  const { stressLevel, motivationLevel, energyLevel } = mentalState.currentState;
  
  let difficulty = constants.DIFFICULTY_LEVELS.BEGINNER;
  let estimatedTime = 30;
  
  if (stressLevel === 'high' || energyLevel === 'low') {
    difficulty = constants.DIFFICULTY_LEVELS.BEGINNER;
    estimatedTime = 20;
  } else if (motivationLevel === 'high' && energyLevel === 'high') {
    difficulty = constants.DIFFICULTY_LEVELS.ADVANCED;
    estimatedTime = 60;
  }
  
  return this.getActiveRecommendations()
    .filter(r => r.difficulty === difficulty && r.estimatedTime <= estimatedTime)
    .slice(0, 3);
};

// Clean up logic
recommendedTopicsSchema.methods.cleanupExpired = function() {
  const now = new Date();
  this.recommendations = this.recommendations.filter(r => 
    !r.expiresAt || r.expiresAt > now || r.status !== 'recommended'
  );
};

// Analytics helper
recommendedTopicsSchema.methods.getStatistics = function() {
  const total = this.recommendations.length;
  const metrics = {
    total,
    active: this.recommendations.filter(r => r.status === 'recommended').length,
    viewed: this.recommendations.filter(r => r.status === 'viewed').length,
    started: this.recommendations.filter(r => r.status === 'started').length,
    completed: this.recommendations.filter(r => r.status === 'completed').length,
    byCategory: {},
    byDifficulty: {},
    averageRelevance: this.recommendations.reduce((sum, r) => sum + r.relevanceScore, 0) / total || 0,
    lastGenerated: this.lastGenerated
  };
  
  constants.TOPIC_CATEGORIES.forEach(cat => {
    metrics.byCategory[cat] = this.recommendations.filter(r => r.category === cat).length;
  });
  
  Object.values(constants.DIFFICULTY_LEVELS).forEach(diff => {
    metrics.byDifficulty[diff] = this.recommendations.filter(r => r.difficulty === diff).length;
  });
  
  return metrics;
};

// --- Indexes ---
recommendedTopicsSchema.index({ studentId: 1, 'recommendations.status': 1 });
recommendedTopicsSchema.index({ studentId: 1, 'recommendations.category': 1 });
recommendedTopicsSchema.index({ studentId: 1, 'recommendations.relevanceScore': -1 });
recommendedTopicsSchema.index({ 'categories.trending.popularity': -1 });

const RecommendedTopics = mongoose.model('RecommendedTopics', recommendedTopicsSchema);
export default RecommendedTopics;