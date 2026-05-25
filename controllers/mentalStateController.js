// backend/controllers/mentalStateController.js
import MentalState from '../models/MentalState.js';
import Activity from '../models/Activity.js';
import LearningPath from '../models/LearningPath.js';
import StudentProgress from '../models/StudentProgress.js';
import RecommendedTopics from '../models/RecommendedTopics.js';
import constants from '../config/constants.js';
import aiService from '../services/aiService.js';
import huggingFaceService from '../services/huggingfaceService.js';

// @desc    Update student's mental state
// @route   POST /api/mental-state/update
// @access  Private (Student)
export const updateMentalState = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { 
      stressLevel, 
      motivationLevel, 
      energyLevel, 
      focusLevel, 
      mood, 
      notes,
      factors,
      sleepHours,
      exerciseMinutes
    } = req.body;

    // Find or create mental state record
    let mentalState = await MentalState.findOne({ studentId });
    
    if (!mentalState) {
      mentalState = new MentalState({ studentId });
    }

    const previousState = { ...mentalState.currentState };

    // Update current state
    mentalState.currentState = {
      stressLevel: stressLevel || mentalState.currentState?.stressLevel || 'unknown',
      motivationLevel: motivationLevel || mentalState.currentState?.motivationLevel || 'unknown',
      energyLevel: energyLevel || mentalState.currentState?.energyLevel || 'unknown',
      focusLevel: focusLevel || mentalState.currentState?.focusLevel || 'unknown',
      mood: mood || mentalState.currentState?.mood || 'neutral',
      notes: notes || mentalState.currentState?.notes || ''
    };

    // Add to history
    mentalState.history.push({
      ...mentalState.currentState,
      notes: notes || '',
      factors: factors || [],
      sleepHours: sleepHours || null,
      exerciseMinutes: exerciseMinutes || null,
      date: new Date()
    });

    // ✅ FIX: Add learningPath variable declaration
    let learningPath = null;
    try {
      learningPath = await LearningPath.findOne({ studentId });
    } catch (error) {
      console.log('Error fetching learning path:', error.message);
    }

    // Generate AI-powered wellness tip using Hugging Face
    let wellnessTip = null;
    try {
      if (huggingFaceService && typeof huggingFaceService.generateWellnessTip === 'function') {
        wellnessTip = await huggingFaceService.generateWellnessTip(mentalState.currentState);
      }
    } catch (error) {
      wellnessTip = "Take a moment to breathe. You're doing great!";
    }

    // Generate affirmation based on mood
    let affirmation = null;
    try {
      if (huggingFaceService && typeof huggingFaceService.generateAffirmation === 'function') {
        affirmation = await huggingFaceService.generateAffirmation(mentalState.currentState.mood);
      }
    } catch (error) {
      affirmation = "You are capable of amazing things.";
    }

    // Analyze sentiment if notes were provided
    let sentimentAnalysis = null;
    if (notes && notes.trim().length > 10) {
      try {
        if (huggingFaceService && typeof huggingFaceService.analyzeSentiment === 'function') {
          sentimentAnalysis = await huggingFaceService.analyzeSentiment(notes);
        }
      } catch (error) {
        console.log('Sentiment analysis error:', error.message);
      }
    }

    // Update recommendations based on new state
    try {
      if (typeof mentalState.updateRecommendations === 'function') {
        mentalState.updateRecommendations();
      }
    } catch (error) {
      console.log('Error updating recommendations:', error.message);
    }

    // Analyze patterns if we have enough history
    if (mentalState.history.length >= 7) {
      try {
        if (typeof mentalState.analyzePatterns === 'function') mentalState.analyzePatterns();
        if (typeof mentalState.detectWarnings === 'function') mentalState.detectWarnings();
        if (typeof mentalState.calculateTrends === 'function') mentalState.calculateTrends();
      } catch (error) {
        console.log('Error analyzing patterns:', error.message);
      }
    }

    mentalState.lastUpdated = new Date();
    await mentalState.save();

    // Adjust learning path based on mental state
    try {
      await adjustLearningPath(studentId, mentalState.currentState);
    } catch (error) {
      console.log('Error adjusting learning path:', error.message);
    }

    // Adjust topic recommendations based on mental state
    try {
      await adjustRecommendations(studentId, mentalState.currentState);
    } catch (error) {
      console.log('Error adjusting recommendations:', error.message);
    }

    // Add activity
    try {
      await Activity.findOneAndUpdate(
        { studentId },
        {
          $push: {
            activities: {
              type: 'mental_state_updated',
              title: 'Mental State Updated',
              description: getActivityDescription(mentalState.currentState, previousState),
              metadata: {
                mood: mentalState.currentState.mood,
                stressLevel: mentalState.currentState.stressLevel,
                motivationLevel: mentalState.currentState.motivationLevel,
                energyLevel: mentalState.currentState.energyLevel,
                wellnessTip: wellnessTip || null,
                affirmation: affirmation || null,
                sentiment: sentimentAnalysis || null
              },
              icon: getMoodIcon(mentalState.currentState.mood),
              color: getMoodColor(mentalState.currentState.mood),
              importance: 'medium',
              timestamp: new Date()
            }
          }
        },
        { upsert: true }
      );
    } catch (error) {
      console.log('Error adding activity:', error.message);
    }

    // Get mood recommendations
    let moodRecommendations = [];
    try {
      if (typeof mentalState.getMoodRecommendations === 'function') {
        moodRecommendations = mentalState.getMoodRecommendations() || [];
      }
      
      // Add Hugging Face generated wellness tip as a recommendation
      if (wellnessTip) {
        moodRecommendations.unshift({
          type: 'wellness',
          title: 'Personalized Wellness Tip',
          description: wellnessTip,
          action: 'Take a moment',
          icon: '💡',
          source: 'AI'
        });
      }
    } catch (error) {
      console.log('Error getting mood recommendations:', error.message);
    }

    // Get study suggestions
    let studySuggestions = [];
    try {
      if (typeof mentalState.getStudySuggestions === 'function') {
        studySuggestions = mentalState.getStudySuggestions() || [];
      }
    } catch (error) {
      console.log('Error getting study suggestions:', error.message);
    }

    // Get mental health tip if needed
    let mentalHealthTip = null;
    if (mentalState.currentState.stressLevel === 'high' || 
        mentalState.currentState.motivationLevel === 'low' ||
        mentalState.currentState.mood === 'sad' || 
        mentalState.currentState.mood === 'anxious') {
      try {
        if (aiService && typeof aiService.getMentalHealthTip === 'function') {
          mentalHealthTip = await aiService.getMentalHealthTip(mentalState.currentState);
        }
      } catch (error) {
        console.log('Failed to get mental health tip:', error.message);
      }
    }

    // Prepare response with AI-generated content
    res.json({
      success: true,
      message: 'Mental state updated successfully',
      data: {
        currentState: mentalState.currentState,
        recommendations: moodRecommendations,
        studySuggestions: studySuggestions,
        wellnessTip: wellnessTip,
        affirmation: affirmation,
        sentimentAnalysis: sentimentAnalysis,
        adjustedLearningPath: learningPath?.currentPath,
        mentalHealthTip: mentalHealthTip,
        trends: mentalState.insights?.trends,
        warnings: mentalState.insights?.warnings,
        historyLength: mentalState.history.length
      }
    });

  } catch (error) {
    console.error('❌ Mental state update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating mental state',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get mental state history
// @route   GET /api/mental-state/history
// @access  Private (Student)
export const getMentalStateHistory = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { days = 30, type } = req.query;

    const mentalState = await MentalState.findOne({ studentId });
    
    if (!mentalState) {
      return res.json({
        success: true,
        data: {
          history: [],
          stats: {},
          patterns: {},
          currentState: null
        }
      });
    }

    // Filter history by date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    let history = mentalState.history.filter(
      entry => entry.date >= cutoffDate
    );

    // Filter by type if specified
    if (type) {
      history = history.filter(entry => entry.mood === type || entry.stressLevel === type);
    }

    // Calculate statistics
    const stats = calculateHistoryStats(history);

    // Group by day for charting
    const daily = groupHistoryByDay(history);

    // Get patterns
    const patterns = mentalState.patterns || {};

    res.json({
      success: true,
      data: {
        history: history.slice(-50),
        daily,
        stats,
        patterns,
        trends: mentalState.insights?.trends,
        warnings: mentalState.insights?.warnings,
        currentState: mentalState.currentState
      }
    });

  } catch (error) {
    console.error('Mental state history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching history',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// Enhanced getMentalHealthInsights with Hugging Face
export const getMentalHealthInsights = async (req, res) => {
  try {
    const studentId = req.user.id;
    const mentalState = await MentalState.findOne({ studentId });
    
    if (!mentalState || mentalState.history.length < 3) {
      return res.json({
        success: true,
        data: {
          insights: [],
          summary: "Not enough data for insights. Please update your mental state regularly.",
          recommendations: [],
          studySuggestions: []
        }
      });
    }

    // Generate AI-powered insights using Hugging Face
    let aiInsight = null;
    try {
      if (huggingFaceService && typeof huggingFaceService.callHuggingFace === 'function') {
        const recentMood = mentalState.currentState.mood;
        const prompt = `Based on feeling ${recentMood}, provide a brief learning tip (2-3 sentences) for optimal focus and retention.`;
        
        const result = await huggingFaceService.callHuggingFace(
          huggingFaceService.models?.textGen || "gpt2", 
          prompt, 
          { max_length: 100 }
        );
        
        if (result && result[0]?.generated_text) {
          aiInsight = {
            type: 'ai_insight',
            title: 'AI Learning Insight',
            description: result[0].generated_text.replace(prompt, '').trim(),
            icon: '🤖'
          };
        }
      }
    } catch (error) {
      console.log('AI insight generation error:', error.message);
    }

    // Generate insights from patterns
    const insights = await generateInsights(mentalState);
    
    // Add AI insight if available
    if (aiInsight) {
      insights.unshift(aiInsight);
    }

    // Get mood-based recommendations
    let recommendations = [];
    try {
      if (typeof mentalState.getMoodRecommendations === 'function') {
        recommendations = mentalState.getMoodRecommendations() || [];
      }
    } catch (error) {
      console.log('Error getting recommendations:', error.message);
    }

    // Get study suggestions
    let studySuggestions = [];
    try {
      if (typeof mentalState.getStudySuggestions === 'function') {
        studySuggestions = mentalState.getStudySuggestions() || [];
      }
    } catch (error) {
      console.log('Error getting study suggestions:', error.message);
    }

    // Generate summary with AI
    let summary = generateMentalHealthSummary(mentalState);
    try {
      if (huggingFaceService && typeof huggingFaceService.callHuggingFace === 'function') {
        const summaryPrompt = `Based on mood patterns: ${JSON.stringify(mentalState.patterns.commonMoods?.slice(0, 3))}. Provide a brief summary of learning readiness (1 sentence).`;
        const result = await huggingFaceService.callHuggingFace(
          huggingFaceService.models?.textGen || "gpt2",
          summaryPrompt,
          { max_length: 50 }
        );
        
        if (result && result[0]?.generated_text) {
          summary = result[0].generated_text.replace(summaryPrompt, '').trim();
        }
      }
    } catch (error) {
      console.log('AI summary error:', error.message);
    }

    res.json({
      success: true,
      data: {
        insights: insights.slice(0, 10),
        recommendations,
        studySuggestions,
        summary,
        trends: mentalState.insights?.trends,
        warnings: mentalState.insights?.warnings,
        lastAnalyzed: mentalState.insights?.lastAnalysis,
        aiPowered: true
      }
    });

  } catch (error) {
    console.error('Mental health insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating insights',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get mental health trends
// @route   GET /api/mental-state/trends
// @access  Private (Student)
export const getMentalHealthTrends = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { period = 'week' } = req.query;

    const mentalState = await MentalState.findOne({ studentId });
    
    if (!mentalState) {
      return res.json({
        success: true,
        data: {
          trends: [],
          correlations: []
        }
      });
    }

    let days = 7;
    if (period === 'month') days = 30;
    if (period === 'quarter') days = 90;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const recentHistory = mentalState.history.filter(
      entry => entry.date >= cutoffDate
    );
    
    // Calculate trends
    const trends = calculateTrends(recentHistory);
    
    // Find correlations with study patterns
    const progress = await StudentProgress.findOne({ studentId });
    const correlations = await findCorrelations(recentHistory, progress);
    
    res.json({
      success: true,
      data: {
        trends,
        correlations,
        period,
        dataPoints: recentHistory.length
      }
    });
    
  } catch (error) {
    console.error('Mental health trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching trends',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// Enhanced addJournalEntry with sentiment analysis
export const addJournalEntry = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { content, type = 'general' } = req.body;

    const mentalState = await MentalState.findOne({ studentId });
    
    if (!mentalState) {
      return res.status(404).json({
        success: false,
        message: 'Mental state record not found'
      });
    }

    // Analyze sentiment of journal entry using Hugging Face
    let sentiment = null;
    try {
      if (huggingFaceService && typeof huggingFaceService.analyzeSentiment === 'function') {
        sentiment = await huggingFaceService.analyzeSentiment(content);
      }
    } catch (error) {
      console.log('Sentiment analysis error:', error.message);
    }

    // Add journal entry to history with sentiment analysis
    mentalState.history.push({
      ...mentalState.currentState,
      notes: content,
      isJournal: true,
      journalType: type,
      sentiment: sentiment,
      date: new Date()
    });

    await mentalState.save();

    // Add activity with sentiment
    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'mental_state_updated',
            title: 'Journal Entry Added',
            description: `Added a ${type} journal entry`,
            metadata: { 
              type, 
              sentiment: sentiment?.analysis || 'neutral',
              confidence: sentiment?.score || 0
            },
            icon: '📔',
            color: '#8b5cf6',
            importance: 'low',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: 'Journal entry added',
      data: {
        entryCount: mentalState.history.filter(h => h.isJournal).length,
        sentiment: sentiment
      }
    });

  } catch (error) {
    console.error('Journal entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error adding journal entry',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ============= HELPER FUNCTIONS (Keep these as is) =============

const adjustLearningPath = async (studentId, mentalState) => {
  const learningPath = await LearningPath.findOne({ studentId });
  if (!learningPath) return;
  
  const { stressLevel, motivationLevel, energyLevel, focusLevel } = mentalState;
  
  if (stressLevel === 'high' || energyLevel === 'low') {
    learningPath.settings.dailyGoal = Math.max(30, (learningPath.settings?.dailyGoal || 60) * 0.7);
  } else if (motivationLevel === 'high' && energyLevel === 'high' && focusLevel === 'high') {
    learningPath.settings.dailyGoal = Math.min(120, (learningPath.settings?.dailyGoal || 60) * 1.3);
  }
  
  await learningPath.save();
};

const adjustRecommendations = async (studentId, mentalState) => {
  const recommendations = await RecommendedTopics.findOne({ studentId });
  if (!recommendations) return;
  
  const { stressLevel, motivationLevel, energyLevel } = mentalState;
  
  recommendations.recommendations?.forEach(rec => {
    if (stressLevel === 'high' || energyLevel === 'low') {
      if (rec.difficulty === 'advanced') {
        rec.relevanceScore = (rec.relevanceScore || 50) * 0.7;
      } else if (rec.difficulty === 'beginner') {
        rec.relevanceScore = (rec.relevanceScore || 50) * 1.3;
      }
    } else if (motivationLevel === 'high') {
      if (rec.difficulty === 'advanced') {
        rec.relevanceScore = (rec.relevanceScore || 50) * 1.3;
      } else if (rec.difficulty === 'beginner') {
        rec.relevanceScore = (rec.relevanceScore || 50) * 0.7;
      }
    }
  });
  
  if (recommendations.recommendations && Array.isArray(recommendations.recommendations)) {
    recommendations.recommendations.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }
  
  await recommendations.save();
};

const getActivityDescription = (current, previous) => {
  const parts = [];
  if (current.mood !== previous?.mood) parts.push(`Feeling ${current.mood}`);
  if (current.stressLevel !== previous?.stressLevel) parts.push(`stress ${current.stressLevel}`);
  if (current.motivationLevel !== previous?.motivationLevel) parts.push(`motivation ${current.motivationLevel}`);
  return parts.length > 0 ? parts.join(', ') : 'Mental state updated';
};

const getMoodIcon = (mood) => {
  const icons = { happy: '😊', neutral: '😐', sad: '😔', anxious: '😰', tired: '😴', energetic: '⚡' };
  return icons[mood] || '😐';
};

const getMoodColor = (mood) => {
  const colors = { happy: '#10b981', neutral: '#6b7280', sad: '#3b82f6', anxious: '#f59e0b', tired: '#8b5cf6', energetic: '#ef4444' };
  return colors[mood] || '#6b7280';
};

const calculateHistoryStats = (history) => {
  if (!history || history.length === 0) return {};
  
  const stats = {
    total: history.length,
    byMood: {},
    byStress: {},
    byMotivation: {},
    byEnergy: {},
    averageSleep: 0,
    totalExercise: 0
  };
  
  history.forEach(entry => {
    if (entry.mood) stats.byMood[entry.mood] = (stats.byMood[entry.mood] || 0) + 1;
    if (entry.stressLevel) stats.byStress[entry.stressLevel] = (stats.byStress[entry.stressLevel] || 0) + 1;
    if (entry.motivationLevel) stats.byMotivation[entry.motivationLevel] = (stats.byMotivation[entry.motivationLevel] || 0) + 1;
    if (entry.energyLevel) stats.byEnergy[entry.energyLevel] = (stats.byEnergy[entry.energyLevel] || 0) + 1;
    if (entry.sleepHours) stats.averageSleep += entry.sleepHours;
    if (entry.exerciseMinutes) stats.totalExercise += entry.exerciseMinutes;
  });
  
  stats.averageSleep = stats.averageSleep / history.length;
  
  stats.moodPercentages = {};
  Object.entries(stats.byMood).forEach(([mood, count]) => {
    stats.moodPercentages[mood] = (count / history.length * 100).toFixed(1);
  });
  
  return stats;
};

const groupHistoryByDay = (history) => {
  const daily = {};
  
  history.forEach(entry => {
    const date = entry.date.toISOString().split('T')[0];
    if (!daily[date]) {
      daily[date] = {
        date: entry.date,
        moods: [],
        stressLevels: [],
        motivationLevels: [],
        energyLevels: []
      };
    }
    
    if (entry.mood) daily[date].moods.push(entry.mood);
    if (entry.stressLevel) daily[date].stressLevels.push(entry.stressLevel);
    if (entry.motivationLevel) daily[date].motivationLevels.push(entry.motivationLevel);
    if (entry.energyLevel) daily[date].energyLevels.push(entry.energyLevel);
  });
  
  Object.values(daily).forEach(day => {
    day.dominantMood = getMode(day.moods);
    day.averageStress = getAverageLevel(day.stressLevels);
    day.averageMotivation = getAverageLevel(day.motivationLevels);
    day.averageEnergy = getAverageLevel(day.energyLevels);
  });
  
  return daily;
};

const getMode = (arr) => {
  if (!arr || arr.length === 0) return 'neutral';
  const counts = {};
  arr.forEach(item => counts[item] = (counts[item] || 0) + 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
};

const getAverageLevel = (levels) => {
  if (!levels || levels.length === 0) return 'medium';
  const values = levels.map(l => l === 'high' ? 3 : l === 'medium' ? 2 : l === 'low' ? 1 : 2);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg > 2.3) return 'high';
  if (avg > 1.7) return 'medium';
  return 'low';
};

const calculateTrends = (history) => {
  if (!history || history.length < 7) return [];
  const trends = [];
  
  const recentStress = history.slice(-3).filter(h => h.stressLevel === 'high').length;
  if (recentStress >= 2) {
    trends.push({
      type: 'warning',
      title: 'Increasing Stress',
      description: 'Your stress has been high lately. Consider taking breaks.'
    });
  }
  
  const recentMood = history.slice(-3).filter(h => h.mood === 'happy' || h.mood === 'energetic').length;
  if (recentMood <= 1) {
    trends.push({
      type: 'suggestion',
      title: 'Mood Boost Needed',
      description: 'Try some mood-boosting activities.'
    });
  }
  
  return trends;
};

const findCorrelations = async (history, progress) => {
  if (!progress || !history || history.length < 7) return [];
  const correlations = [];
  
  const studyDays = progress.weeklyActivity?.flatMap(w => w.days || []) || [];
  const goodMoodDays = history.filter(h => h.mood === 'happy' || h.mood === 'energetic').map(h => h.date.toDateString());
  const studyOnGoodDays = studyDays.filter(d => d.date && goodMoodDays.includes(new Date(d.date).toDateString()));
  
  if (studyOnGoodDays.length > 3) {
    correlations.push({
      type: 'positive',
      title: 'Study-Mood Connection',
      description: 'You tend to study more on days when you feel good!'
    });
  }
  
  return correlations;
};

const generateInsights = async (mentalState) => {
  const insights = [];
  const history = mentalState.history || [];
  if (history.length < 7) return insights;
  
  const recent = history.slice(-7);
  const positiveMoods = recent.filter(h => h.mood === 'happy' || h.mood === 'energetic').length;
  
  if (positiveMoods / recent.length > 0.7) {
    insights.push({
      type: 'positive',
      title: 'Positive Mood Trend',
      description: 'You\'ve been in a great mood lately! This is excellent for learning.',
      icon: '🌟'
    });
  }
  
  const highStress = recent.filter(h => h.stressLevel === 'high').length;
  if (highStress > 3) {
    insights.push({
      type: 'warning',
      title: 'High Stress Alert',
      description: 'You\'ve been experiencing high stress frequently. Consider mindfulness exercises.',
      icon: '⚠️'
    });
  }
  
  return insights;
};

const generateMentalHealthSummary = (mentalState) => {
  const history = mentalState.history || [];
  if (history.length === 0) {
    return "Start tracking your mental state to receive personalized insights.";
  }
  
  const recent = history.slice(-7);
  const avgStress = recent.filter(h => h.stressLevel === 'high').length / recent.length;
  const avgMotivation = recent.filter(h => h.motivationLevel === 'high').length / recent.length;
  
  if (avgStress > 0.5) {
    return "Your stress levels have been high. Remember to take breaks and practice self-care.";
  } else if (avgMotivation > 0.7) {
    return "You're in a great state for learning! Tackle those challenging topics now.";
  } else if (avgMotivation < 0.3) {
    return "Your motivation seems low. Try breaking down your goals into smaller, achievable steps.";
  }
  
  return "You're maintaining a good balance. Keep up the consistent effort!";
};