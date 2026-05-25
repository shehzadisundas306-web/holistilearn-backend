import mongoose from 'mongoose';
import constants from '../config/constants.js';

const mentalStateSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,  // ✅ This automatically creates an index
  },
  currentState: {
    stressLevel: {
      type: String,
      enum: constants.MENTAL_STATES?.STRESS || ['low', 'medium', 'high', 'unknown'],
      default: 'unknown'
    },
    motivationLevel: {
      type: String,
      enum: constants.MENTAL_STATES?.MOTIVATION || ['low', 'medium', 'high', 'unknown'],
      default: 'unknown'
    },
    energyLevel: {
      type: String,
      enum: constants.MENTAL_STATES?.ENERGY || ['low', 'medium', 'high', 'unknown'],
      default: 'unknown'
    },
    focusLevel: {
      type: String,
      enum: constants.MENTAL_STATES?.FOCUS || ['low', 'medium', 'high', 'unknown'],
      default: 'unknown'
    },
    mood: {
      type: String,
      enum: constants.MENTAL_STATES?.MOOD || ['happy', 'neutral', 'sad', 'anxious', 'tired', 'energetic'],
      default: 'neutral'
    },
    notes: {
      type: String,
      maxlength: 500
    }
  },
  history: [{
    date: {
      type: Date,
      default: Date.now
    },
    stressLevel: String,
    motivationLevel: String,
    energyLevel: String,
    focusLevel: String,
    mood: String,
    notes: String,
    factors: [{
      type: String,
      enum: ['sleep', 'exercise', 'diet', 'social', 'workload', 'personal']
    }],
    sleepHours: {
      type: Number,
      min: 0,
      max: 24
    },
    exerciseMinutes: {
      type: Number,
      min: 0
    }
  }],
  patterns: {
    commonMoods: [{
      mood: String,
      count: Number,
      percentage: Number
    }],
    stressPatterns: {
      highStressDays: Number,
      lowStressDays: Number,
      averageStressLevel: String
    },
    motivationPatterns: {
      highMotivationDays: Number,
      lowMotivationDays: Number,
      averageMotivationLevel: String
    },
    productiveTimes: [{
      hour: Number,
      productivity: Number
    }],
    weeklyPattern: [{
      day: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      },
      averageMood: String,
      averageEnergy: String
    }]
  },
  recommendations: {
    topicDifficulty: {
      type: String,
      enum: constants.DIFFICULTY_LEVELS ? Object.values(constants.DIFFICULTY_LEVELS) : ['beginner', 'intermediate', 'advanced'],
      default: 'beginner'
    },
    quizLength: {
      type: String,
      enum: ['short', 'medium', 'long'],
      default: 'medium'
    },
    breakReminders: {
      type: Boolean,
      default: true
    },
    breakInterval: {
      type: Number,
      default: 25
    },
    preferredStudyTime: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
      default: 'morning'
    },
    motivationalQuotes: [String],
    mentalHealthTips: [{
      tip: String,
      category: String,
      shownAt: Date
    }]
  },
  insights: {
    lastAnalysis: Date,
    trends: {
      stress: {
        trend: {
          type: String,
          enum: ['increasing', 'decreasing', 'stable', 'fluctuating']
        },
        change: Number
      },
      motivation: {
        trend: String,
        change: Number
      },
      energy: {
        trend: String,
        change: Number
      }
    },
    warnings: [{
      type: {
        type: String,
        enum: ['stress_warning', 'motivation_warning', 'sleep_warning', 'mood_warning']
      },
      message: String,
      severity: {
        type: String,
        enum: ['low', 'medium', 'high']
      },
      date: Date
    }]
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// --- Schema Methods ---

// Update recommendations based on current state
mentalStateSchema.methods.updateRecommendations = function() {
  const { stressLevel, motivationLevel, energyLevel, focusLevel, mood } = this.currentState;
  
  if (stressLevel === 'high' || energyLevel === 'low' || focusLevel === 'low') {
    this.recommendations.topicDifficulty = 'beginner';
    this.recommendations.quizLength = 'short';
    this.recommendations.breakInterval = 20; 
  } else if (motivationLevel === 'high' && energyLevel === 'high' && focusLevel === 'high') {
    this.recommendations.topicDifficulty = 'advanced';
    this.recommendations.quizLength = 'long';
    this.recommendations.breakInterval = 45; 
  } else {
    this.recommendations.topicDifficulty = 'intermediate';
    this.recommendations.quizLength = 'medium';
    this.recommendations.breakInterval = 30;
  }
  
  this.recommendations.breakReminders = stressLevel !== 'low';
  
  if (motivationLevel === 'low' || mood === 'sad' || mood === 'anxious') {
    this.addMotivationalQuote();
  }
};

// Add a motivational quote
mentalStateSchema.methods.addMotivationalQuote = function() {
  const quotes = constants.MOTIVATIONAL_QUOTES?.[this.currentState.motivationLevel || 'medium'] || [
    "Every expert was once a beginner.",
    "Small steps every day lead to big results."
  ];
  
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  
  if (!this.recommendations.motivationalQuotes.includes(quote)) {
    this.recommendations.motivationalQuotes.push(quote);
    if (this.recommendations.motivationalQuotes.length > 5) {
      this.recommendations.motivationalQuotes.shift();
    }
  }
};

// Add mental health tip
mentalStateSchema.methods.addMentalHealthTip = function(tip, category) {
  this.recommendations.mentalHealthTips.push({
    tip,
    category,
    shownAt: new Date()
  });
  
  if (this.recommendations.mentalHealthTips.length > 10) {
    this.recommendations.mentalHealthTips.shift();
  }
};

// Analyze patterns from history
mentalStateSchema.methods.analyzePatterns = function() {
  const history = this.history;
  if (history.length < 7) return; 
  
  const moodCounts = {};
  history.forEach(entry => {
    if (entry.mood) {
      moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
    }
  });
  
  this.patterns.commonMoods = Object.entries(moodCounts).map(([mood, count]) => ({
    mood,
    count,
    percentage: (count / history.length) * 100
  })).sort((a, b) => b.count - a.count);
  
  const highStressDays = history.filter(h => h.stressLevel === 'high').length;
  const lowStressDays = history.filter(h => h.stressLevel === 'low').length;
  this.patterns.stressPatterns = {
    highStressDays,
    lowStressDays,
    averageStressLevel: highStressDays > lowStressDays ? 'high' : 
                        lowStressDays > highStressDays ? 'low' : 'medium'
  };
  
  const highMotivationDays = history.filter(h => h.motivationLevel === 'high').length;
  const lowMotivationDays = history.filter(h => h.motivationLevel === 'low').length;
  this.patterns.motivationPatterns = {
    highMotivationDays,
    lowMotivationDays,
    averageMotivationLevel: highMotivationDays > lowMotivationDays ? 'high' : 
                            lowMotivationDays > highMotivationDays ? 'low' : 'medium'
  };
  
  const productiveHours = {};
  history.forEach(entry => {
    const hour = new Date(entry.date).getHours();
    if (!productiveHours[hour]) {
      productiveHours[hour] = { count: 0, totalProductivity: 0 };
    }
    
    const focusScore = entry.focusLevel === 'high' ? 3 : entry.focusLevel === 'medium' ? 2 : 1;
    const energyScore = entry.energyLevel === 'high' ? 3 : entry.energyLevel === 'medium' ? 2 : 1;
    const productivity = (focusScore + energyScore) / 2 * 33.33;
    
    productiveHours[hour].count++;
    productiveHours[hour].totalProductivity += productivity;
  });
  
  this.patterns.productiveTimes = Object.entries(productiveHours)
    .map(([hour, data]) => ({
      hour: parseInt(hour),
      productivity: data.totalProductivity / data.count
    }))
    .sort((a, b) => b.productivity - a.productivity)
    .slice(0, 3);
  
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weeklyData = {};
  
  history.forEach(entry => {
    const date = new Date(entry.date);
    const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
    const day = dayNames[dayIndex];
    if (!weeklyData[day]) {
      weeklyData[day] = { count: 0, moodScore: 0, energyScore: 0 };
    }
    
    const moodScore = (entry.mood === 'happy' || entry.mood === 'energetic') ? 3 : (entry.mood === 'neutral' ? 2 : 1);
    const energyScore = entry.energyLevel === 'high' ? 3 : (entry.energyLevel === 'medium' ? 2 : 1);
    
    weeklyData[day].count++;
    weeklyData[day].moodScore += moodScore;
    weeklyData[day].energyScore += energyScore;
  });
  
  this.patterns.weeklyPattern = Object.entries(weeklyData).map(([day, data]) => ({
    day,
    averageMood: data.moodScore / data.count > 2.5 ? 'good' : (data.moodScore / data.count > 1.5 ? 'neutral' : 'poor'),
    averageEnergy: data.energyScore / data.count > 2.5 ? 'high' : (data.energyScore / data.count > 1.5 ? 'medium' : 'low')
  }));
};

// Detect warnings and generate insights
mentalStateSchema.methods.detectWarnings = function() {
  const warnings = [];
  const recentHistory = this.history.slice(-7);
  
  if (recentHistory.filter(h => h.stressLevel === 'high').length >= 5) {
    warnings.push({
      type: 'stress_warning',
      message: "You've been experiencing high stress. Consider a break.",
      severity: 'high',
      date: new Date()
    });
  }
  
  if (recentHistory.filter(h => h.motivationLevel === 'low').length >= 4) {
    warnings.push({
      type: 'motivation_warning',
      message: 'Motivation is low. Try setting smaller milestones.',
      severity: 'medium',
      date: new Date()
    });
  }
  
  if (recentHistory.filter(h => h.sleepHours && h.sleepHours < 6).length >= 3) {
    warnings.push({
      type: 'sleep_warning',
      message: "Sleep is low. Aim for 7-9 hours for better cognition.",
      severity: 'medium',
      date: new Date()
    });
  }
  
  this.insights.warnings = warnings;
  this.insights.lastAnalysis = new Date();
};

// Calculate trends over 2 weeks
mentalStateSchema.methods.calculateTrends = function() {
  const history = this.history;
  if (history.length < 14) return;
  
  const recent = history.slice(-7);
  const previous = history.slice(-14, -7);
  
  const getAvg = (entries, field) => {
    const values = entries.map(e => {
      const val = e[field];
      return val === 'high' ? 3 : (val === 'medium' ? 2 : 1);
    });
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  
  const metrics = ['stressLevel', 'motivationLevel', 'energyLevel'];
  
  metrics.forEach(m => {
    const recentAvg = getAvg(recent, m);
    const prevAvg = getAvg(previous, m);
    const key = m.replace('Level', '');
    
    this.insights.trends[key] = {
      trend: recentAvg > prevAvg + 0.3 ? 'increasing' : (recentAvg < prevAvg - 0.3 ? 'decreasing' : 'stable'),
      change: ((recentAvg - prevAvg) / (prevAvg || 1)) * 100
    };
  });
};

// Get mood-based recommendations
mentalStateSchema.methods.getMoodRecommendations = function() {
  const recs = [];
  const { mood, stressLevel, energyLevel, motivationLevel } = this.currentState;
  
  if (mood === 'sad' || mood === 'anxious') {
    recs.push({ 
      type: 'mental_health', 
      title: 'Self-Care', 
      description: 'Try a 2-minute breathing exercise.', 
      action: 'Start Exercise',
      icon: '🧘'
    });
  }
  if (stressLevel === 'high') {
    recs.push({ 
      type: 'break', 
      title: 'Break Needed', 
      description: 'Stress is high. Step away for 5 mins.', 
      action: 'Set Reminder',
      icon: '🔄'
    });
  }
  if (energyLevel === 'low') {
    recs.push({ 
      type: 'energy', 
      title: 'Quick Reset', 
      description: 'Try light physical movement.', 
      action: 'Try Movement',
      icon: '⚡'
    });
  }
  if (motivationLevel === 'low') {
    recs.push({ 
      type: 'motivation', 
      title: 'Inspiration', 
      description: 'Review your recent achievements.', 
      action: 'View Achievements',
      icon: '🏆'
    });
  }
  
  return recs;
};

// Get study suggestions based on focus and energy
mentalStateSchema.methods.getStudySuggestions = function() {
  const { focusLevel, energyLevel } = this.currentState;
  
  if (focusLevel === 'high' && energyLevel === 'high') {
    return [{ 
      type: 'challenging', 
      description: 'Peak performance! Tackle complex topics.', 
      recommendedTopics: ['Advanced concepts', 'Logic problems'] 
    }];
  } else if (focusLevel === 'medium' || energyLevel === 'medium') {
    return [{ 
      type: 'moderate', 
      description: 'Steady state. Good for standard practice.', 
      recommendedTopics: ['Review material', 'Standard labs'] 
    }];
  }
  
  return [{ 
    type: 'light', 
    description: 'Low energy. Stick to passive learning.', 
    recommendedTopics: ['Video tutorials', 'Summaries'] 
  }];
};

mentalStateSchema.index({ 'history.date': -1 });
mentalStateSchema.index({ lastUpdated: -1 });

const MentalState = mongoose.model('MentalState', mentalStateSchema);
export default MentalState;