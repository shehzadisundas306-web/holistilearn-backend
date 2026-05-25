/**
 * Activity Model
 * Tracks student interactions, generates summaries, and manages notifications.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const activitySchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  activities: [{
    type: {
      type: String,
      enum: Object.values(constants.ACTIVITY_TYPES),
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: String,
    metadata: {
      topic: String,
      topicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Topic'
      },
      quizId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz'
      },
      noteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AINotes'
      },
      score: Number,
      totalQuestions: Number,
      timeSpent: Number,
      achievementId: String,
      noteTitle: String,
      difficulty: String,
      xpEarned: Number,
      streak: Number,
      mood: String,
      stressLevel: String
    },
    icon: String,
    color: String,
    importance: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    isRead: {
      type: Boolean,
      default: false
    },
    isArchived: {
      type: Boolean,
      default: false
    },
    tags: [String],
    relatedActivities: [{
      type: mongoose.Schema.Types.ObjectId
    }]
  }],
  summary: {
    daily: [{
      date: Date,
      count: Number,
      types: {
        quiz_completed: Number,
        notes_generated: Number,
        topic_started: Number,
        topic_completed: Number,
        achievement_earned: Number,
        mental_state_updated: Number,
      },
      totalXp: Number,
      studyTime: Number
    }],
    weekly: [{
      week: Number,
      year: Number,
      count: Number,
      mostActiveDay: String,
      mostCommonType: String,
      totalXp: Number,
      studyTime: Number
    }]
  },
  notifications: [{
    title: String,
    message: String,
    type: {
      type: String,
      enum: ['achievement', 'reminder', 'tip', 'alert']
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    data: mongoose.Schema.Types.Mixed,
    read: {
      type: Boolean,
      default: false
    },
    readAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date
  }],
  lastProcessed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// --- Schema Methods ---

// Add new activity
activitySchema.methods.addActivity = function(activityData) {
  const activity = {
    ...activityData,
    timestamp: new Date(),
    isRead: false,
    isArchived: false
  };
  
  if (!activity.icon || !activity.color) {
    const defaults = this.getActivityDefaults(activity.type);
    activity.icon = activity.icon || defaults.icon;
    activity.color = activity.color || defaults.color;
  }
  
  this.activities.push(activity);
  this.updateDailySummary(activity);
  
  if (this.activities.length > 100) {
    this.activities = this.activities.slice(-100);
  }
  
  return activity;
};

// Get default icon and color for activity type
activitySchema.methods.getActivityDefaults = function(type) {
  const defaults = {
    quiz_completed: { icon: '📝', color: '#10b981' },
    notes_generated: { icon: '📚', color: '#3b82f6' },
    topic_started: { icon: '🎯', color: '#f59e0b' },
    topic_completed: { icon: '✅', color: '#10b981' },
    achievement_earned: { icon: '🏆', color: '#f59e0b' },
    mental_state_updated: { icon: '🧠', color: '#8b5cf6' }
  };
  
  return defaults[type] || { icon: '📌', color: '#6b7280' };
};

// Update daily summary
activitySchema.methods.updateDailySummary = function(activity) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let dailySummary = this.summary.daily.find(
    d => d.date.toDateString() === today.toDateString()
  );
  
  if (!dailySummary) {
    dailySummary = {
      date: today,
      count: 0,
      types: {
        quiz_completed: 0,
        notes_generated: 0,
        topic_started: 0,
        topic_completed: 0,
        achievement_earned: 0,
        mental_state_updated: 0
      },
      totalXp: 0,
      studyTime: 0
    };
    this.summary.daily.push(dailySummary);
    
    if (this.summary.daily.length > 30) {
      this.summary.daily = this.summary.daily.slice(-30);
    }
  }
  
  dailySummary.count += 1;
  dailySummary.types[activity.type] = (dailySummary.types[activity.type] || 0) + 1;
  
  if (activity.metadata?.xpEarned) {
    dailySummary.totalXp += activity.metadata.xpEarned;
  }
  
  if (activity.metadata?.timeSpent) {
    dailySummary.studyTime += activity.metadata.timeSpent;
  }
  
  this.updateWeeklySummary(activity);
};

// Update weekly summary
activitySchema.methods.updateWeeklySummary = function(activity) {
  const date = new Date();
  const week = this.getWeekNumber(date);
  const year = date.getFullYear();
  
  let weeklySummary = this.summary.weekly.find(
    w => w.week === week && w.year === year
  );
  
  if (!weeklySummary) {
    weeklySummary = {
      week,
      year,
      count: 0,
      mostActiveDay: '',
      mostCommonType: '',
      totalXp: 0,
      studyTime: 0
    };
    this.summary.weekly.push(weeklySummary);
    
    if (this.summary.weekly.length > 12) {
      this.summary.weekly = this.summary.weekly.slice(-12);
    }
  }
  
  weeklySummary.count += 1;
  
  if (activity.metadata?.xpEarned) {
    weeklySummary.totalXp += activity.metadata.xpEarned;
  }
  
  if (activity.metadata?.timeSpent) {
    weeklySummary.studyTime += activity.metadata.timeSpent;
  }
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  weeklySummary.mostActiveDay = dayNames[date.getDay()];
  
  const weekActivities = this.activities.filter(a => {
    const aDate = new Date(a.timestamp);
    return this.getWeekNumber(aDate) === week && aDate.getFullYear() === year;
  });
  
  const typeCounts = {};
  weekActivities.forEach(a => {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  });
  
  let maxCount = 0;
  let mostCommonType = '';
  Object.entries(typeCounts).forEach(([type, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommonType = type;
    }
  });
  
  weeklySummary.mostCommonType = mostCommonType;
};

// Get week number
activitySchema.methods.getWeekNumber = function(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

// Get recent activities
activitySchema.methods.getRecentActivities = function(limit = 10) {
  return this.activities
    .filter(a => !a.isArchived)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
};

// Get activities by type
activitySchema.methods.getActivitiesByType = function(type, limit = 20) {
  return this.activities
    .filter(a => a.type === type && !a.isArchived)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
};

// Get activities by date range
activitySchema.methods.getActivitiesByDateRange = function(startDate, endDate) {
  return this.activities.filter(a => {
    const timestamp = new Date(a.timestamp);
    return timestamp >= startDate && timestamp <= endDate && !a.isArchived;
  }).sort((a, b) => b.timestamp - a.timestamp);
};

// Mark activities as read
activitySchema.methods.markAsRead = function(activityIds) {
  this.activities.forEach(activity => {
    if (activityIds.includes(activity._id.toString())) {
      activity.isRead = true;
    }
  });
};

// Add notification
activitySchema.methods.addNotification = function(notificationData) {
  const notification = {
    ...notificationData,
    createdAt: new Date(),
    read: false
  };
  
  if (!notification.expiresAt) {
    notification.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 
  }
  
  this.notifications.push(notification);
  
  if (this.notifications.length > 50) {
    this.notifications = this.notifications.slice(-50);
  }
  
  return notification;
};

// Get unread notifications
activitySchema.methods.getUnreadNotifications = function() {
  return this.notifications
    .filter(n => !n.read && n.expiresAt > new Date())
    .sort((a, b) => b.createdAt - a.createdAt);
};

// Mark notification as read
activitySchema.methods.markNotificationAsRead = function(notificationId) {
  const notification = this.notifications.id(notificationId);
  if (notification) {
    notification.read = true;
    notification.readAt = new Date();
  }
};

// Get activity heatmap data
activitySchema.methods.getHeatmapData = function(days = 365) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const heatmap = {};
  
  this.activities.forEach(activity => {
    const date = new Date(activity.timestamp);
    if (date >= startDate) {
      const dateStr = date.toISOString().split('T')[0];
      if (!heatmap[dateStr]) {
        heatmap[dateStr] = {
          count: 0,
          xp: 0,
          studyTime: 0
        };
      }
      heatmap[dateStr].count += 1;
      if (activity.metadata?.xpEarned) {
        heatmap[dateStr].xp += activity.metadata.xpEarned;
      }
      if (activity.metadata?.timeSpent) {
        heatmap[dateStr].studyTime += activity.metadata.timeSpent;
      }
    }
  });
  
  return heatmap;
};

// Get activity streak
activitySchema.methods.getActivityStreak = function() {
  const sorted = this.activities
    .filter(a => !a.isArchived)
    .sort((a, b) => b.timestamp - a.timestamp);
  
  if (sorted.length === 0) return 0;
  
  let streak = 1;
  let currentDate = new Date(sorted[0].timestamp);
  currentDate.setHours(0, 0, 0, 0);
  
  for (let i = 1; i < sorted.length; i++) {
    const activityDate = new Date(sorted[i].timestamp);
    activityDate.setHours(0, 0, 0, 0);
    
    const dayDiff = Math.floor((currentDate - activityDate) / (24 * 60 * 60 * 1000));
    
    if (dayDiff === 1) {
      streak++;
      currentDate = activityDate;
    } else if (dayDiff > 1) {
      break;
    }
  }
  
  return streak;
};

// Get activity summary for dashboard
activitySchema.methods.getDashboardSummary = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayActivities = this.activities.filter(
    a => new Date(a.timestamp) >= today && !a.isArchived
  );
  
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  
  const weekActivities = this.activities.filter(
    a => new Date(a.timestamp) >= weekStart && !a.isArchived
  );
  
  return {
    today: {
      count: todayActivities.length,
      byType: this.groupByType(todayActivities),
      xpEarned: todayActivities.reduce((sum, a) => sum + (a.metadata?.xpEarned || 0), 0),
      studyTime: todayActivities.reduce((sum, a) => sum + (a.metadata?.timeSpent || 0), 0)
    },
    week: {
      count: weekActivities.length,
      byType: this.groupByType(weekActivities),
      xpEarned: weekActivities.reduce((sum, a) => sum + (a.metadata?.xpEarned || 0), 0),
      studyTime: weekActivities.reduce((sum, a) => sum + (a.metadata?.timeSpent || 0), 0)
    },
    streak: this.getActivityStreak(),
    unreadNotifications: this.getUnreadNotifications().length
  };
};

// Helper to group activities by type
activitySchema.methods.groupByType = function(activities) {
  const grouped = {};
  activities.forEach(a => {
    grouped[a.type] = (grouped[a.type] || 0) + 1;
  });
  return grouped;
};

// Clean up old notifications
activitySchema.methods.cleanupNotifications = function() {
  this.notifications = this.notifications.filter(
    n => n.expiresAt > new Date()
  );
};

// --- Indexes ---
// activitySchema.index({ studentId: 1, 'activities.timestamp': -1 });
// activitySchema.index({ studentId: 1, 'notifications.createdAt': -1 });
activitySchema.index({ 'activities.type': 1 });
activitySchema.index({ 'summary.daily.date': -1 });

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;