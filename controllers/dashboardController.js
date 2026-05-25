// backend/controllers/dashboardController.js
import StudentProgress from '../models/StudentProgress.js';
import MentalState from '../models/MentalState.js';
import QuizHistory from '../models/QuizHistory.js';
import AINotes from '../models/AINotes.js';
import Activity from '../models/Activity.js';
import LearningPath from '../models/LearningPath.js';
import RecommendedTopics from '../models/RecommendedTopics.js';
import User from '../models/userModel.js';
import constants from '../config/constants.js';
import { triggerProgressUpdate, emitIncrementalUpdate } from '../config/socket.js';

// Helper function to get week number
const getWeekNumber = (date) => {
  try {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  } catch (error) {
    return 1;
  }
};

// @desc    Get complete dashboard data with socket emission
// @route   GET /api/dashboard
// @access  Private (Student)
export const getDashboardData = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;

    // Fetch all required data in parallel
    const [
      user,
      progress,
      mentalState,
      quizHistory,
      aiNotes,
      learningPath,
      recommendedTopics,
      activity
    ] = await Promise.all([
      User.findById(studentId).select('-password'),
      StudentProgress.findOne({ studentId }),
      MentalState.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      AINotes.findOne({ studentId }),
      LearningPath.findOne({ studentId }),
      RecommendedTopics.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    let recentActivities = [];
    try {
      if (activity) {
        if (typeof activity.getRecentActivities === 'function') {
          recentActivities = activity.getRecentActivities(10) || [];
        } else if (activity.activities && Array.isArray(activity.activities)) {
          recentActivities = activity.activities.slice(-10) || [];
        }
      }
    } catch (error) {
      recentActivities = [];
    }

    let todaySummary = { today: { count: 0, xpEarned: 0, studyTime: 0 }, streak: 0 };
    try {
      if (activity && typeof activity.getDashboardSummary === 'function') {
        const summary = activity.getDashboardSummary();
        todaySummary = summary || todaySummary;
      }
    } catch (error) {
      console.log('Error getting dashboard summary:', error.message);
    }

    let activeRecommendations = [];
    try {
      if (recommendedTopics) {
        if (typeof recommendedTopics.getActiveRecommendations === 'function') {
          activeRecommendations = recommendedTopics.getActiveRecommendations(6) || [];
        } else if (recommendedTopics.recommendations && Array.isArray(recommendedTopics.recommendations)) {
          activeRecommendations = recommendedTopics.recommendations.filter(r => r.status === 'recommended') || [];
        }
      }
    } catch (error) {
      activeRecommendations = [];
    }

    let currentMilestone = null;
    try {
      if (learningPath && typeof learningPath.getCurrentMilestone === 'function') {
        currentMilestone = learningPath.getCurrentMilestone();
      }
    } catch (error) {
      console.log('Error getting current milestone:', error.message);
    }

    let nextSteps = [];
    try {
      if (learningPath && typeof learningPath.getNextSteps === 'function') {
        nextSteps = learningPath.getNextSteps() || [];
      }
    } catch (error) {
      console.log('Error getting next steps:', error.message);
    }

    let mentalRecommendations = { studySuggestions: [], moodRecommendations: [] };
    if (mentalState) {
      try {
        if (typeof mentalState.getStudySuggestions === 'function') {
          const suggestions = mentalState.getStudySuggestions();
          if (suggestions && Array.isArray(suggestions)) mentalRecommendations.studySuggestions = suggestions;
        }
      } catch (error) { console.log('⚠️ Error in getStudySuggestions:', error.message); }

      try {
        if (typeof mentalState.getMoodRecommendations === 'function') {
          const recommendations = mentalState.getMoodRecommendations();
          if (recommendations && Array.isArray(recommendations)) mentalRecommendations.moodRecommendations = recommendations;
        }
      } catch (error) { console.log('⚠️ Error in getMoodRecommendations:', error.message); }
    }

    let quizStats = { 
      totalQuizzes: 0, 
      averageScore: 0, 
      weakTopics: [], 
      topicsMastered: [],
      bestScore: 0,
      totalTimeSpent: 0
    };
    
    try {
      if (quizHistory && quizHistory.statistics) {
        quizStats = {
          totalQuizzes: quizHistory.statistics.totalQuizzes || 0,
          averageScore: quizHistory.statistics.averageScore || 0,
          weakTopics: quizHistory.statistics.weakTopics || [],
          topicsMastered: quizHistory.statistics.topicsMastered || [],
          bestScore: quizHistory.statistics.bestScore || 0,
          totalTimeSpent: quizHistory.statistics.totalTimeSpent || 0
        };
      }
    } catch (error) { 
      console.log('Error getting quiz stats:', error.message); 
    }

    let notesStats = { totalNotes: 0, totalDownloads: 0, studyTime: 0 };
    try {
      if (aiNotes && aiNotes.statistics) {
        notesStats = {
          totalNotes: aiNotes.statistics.totalNotes || 0,
          totalDownloads: aiNotes.statistics.totalDownloads || 0,
          studyTime: aiNotes.statistics.studyTime || 0
        };
      }
    } catch (error) { console.log('Error getting notes stats:', error.message); }

    const mentalStateData = {
      stressLevel: mentalState?.currentState?.stressLevel || 'unknown',
      motivationLevel: mentalState?.currentState?.motivationLevel || 'unknown',
      energyLevel: mentalState?.currentState?.energyLevel || 'unknown',
      focusLevel: mentalState?.currentState?.focusLevel || 'unknown',
      mood: mentalState?.currentState?.mood || 'neutral'
    };

    const dashboardData = {
      user: {
        id: user?._id || studentId,
        name: user?.name || 'User',
        email: user?.email || '',
        avatar: user?.profile?.avatar || null,
        role: user?.role || 'student',
        preferences: user?.profile || {}
      },
      progress: {
        stats: progress?.stats || { 
          completedLessons: 0, 
          quizzesTaken: 0, 
          averageScore: 0, 
          learningStreak: 0, 
          xpPoints: 0, 
          level: 1, 
          totalStudyTime: 0, 
          totalTopics: 0, 
          completedTopics: 0 
        },
        weeklyActivity: (progress?.weeklyActivity && Array.isArray(progress.weeklyActivity)) ? progress.weeklyActivity.slice(-4) : [],
        overallProgress: 0,
        todayStudyTime: progress?.getTodayStudyTime ? progress.getTodayStudyTime() : 0,
        weeklyStudyTime: progress?.getWeeklyStudyTime ? progress.getWeeklyStudyTime() : 0
      },
      mentalState: {
        current: mentalStateData,
        recommendations: mentalRecommendations,
        insights: mentalState?.insights || {},
        trends: mentalState?.insights?.trends || {},
        lastUpdated: mentalState?.lastUpdated || null
      },
      learning: {
        currentPath: learningPath?.currentPath || { goal: 'Start Learning', progress: 0, milestones: [] },
        currentMilestone,
        nextSteps,
        schedule: [],
        isOnTrack: true,
        timeRemaining: null
      },
      recommendations: {
        topics: activeRecommendations,
        forYou: recommendedTopics?.categories?.forYou || [],
        trending: recommendedTopics?.categories?.trending || [],
        basedOnHistory: recommendedTopics?.categories?.basedOnHistory || []
      },
      quiz: { 
        statistics: quizStats, 
        nextRecommended: quizHistory?.getNextRecommendedQuiz ? quizHistory.getNextRecommendedQuiz() : null,
        performanceTrend: quizHistory?.getPerformanceTrend ? quizHistory.getPerformanceTrend() : [],
        weakTopics: quizStats.weakTopics || []
      },
      notes: { 
        total: notesStats.totalNotes, 
        recent: [], 
        popular: [], 
        totalDownloads: notesStats.totalDownloads, 
        studyTime: notesStats.studyTime 
      },
      activity: { recent: recentActivities, summary: todaySummary, heatmap: {} },
      achievements: (progress?.achievements && Array.isArray(progress.achievements)) ? progress.achievements.slice(-5) : [],
      goals: { 
        daily: learningPath?.settings?.dailyGoal || 60, 
        weekly: (learningPath?.settings?.dailyGoal || 60) * 7, 
        streak: progress?.stats?.learningStreak || 0 
      },
      timestamps: { 
        lastActive: progress?.stats?.lastActive || null, 
        lastMentalUpdate: mentalState?.lastUpdated || null, 
        dashboardGenerated: new Date() 
      }
    };

    // Emit dashboard update via socket
    if (io) {
      io.to(`user:${studentId}`).emit('dashboard-update', {
        type: 'full_dashboard',
        data: {
          progress: dashboardData.progress,
          quiz: dashboardData.quiz,
          mentalState: dashboardData.mentalState.current,
          achievements: dashboardData.achievements,
          todayActivity: dashboardData.activity.summary
        },
        timestamp: new Date()
      });
    }

    res.json({ success: true, data: dashboardData });
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Error fetching dashboard data', error: error.message });
  }
};

// @desc    Get dashboard summary (lightweight version) with socket
// @route   GET /api/dashboard/summary
// @access  Private (Student)
export const getDashboardSummary = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;
    
    const [progress, quizHistory, activity, mentalState] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      Activity.findOne({ studentId }),
      MentalState.findOne({ studentId })
    ]);

    let todayData = { count: 0, xpEarned: 0, studyTime: 0 };
    if (activity && typeof activity.getDashboardSummary === 'function') {
      const summary = activity.getDashboardSummary();
      todayData = summary.today || todayData;
    }

    let unreadCount = 0;
    if (activity && typeof activity.getUnreadNotifications === 'function') {
      const unread = activity.getUnreadNotifications();
      unreadCount = unread.length || 0;
    }

    const summaryData = {
      progress: {
        level: progress?.stats?.level || 1,
        xp: progress?.stats?.xpPoints || 0,
        streak: progress?.stats?.learningStreak || 0,
        completedTopics: progress?.stats?.completedTopics || 0
      },
      quiz: {
        totalQuizzes: quizHistory?.statistics?.totalQuizzes || 0,
        averageScore: quizHistory?.statistics?.averageScore || 0,
        weakTopics: quizHistory?.statistics?.weakTopics || []
      },
      today: todayData,
      mentalState: {
        mood: mentalState?.currentState?.mood || 'neutral',
        stressLevel: mentalState?.currentState?.stressLevel || 'unknown'
      },
      unreadNotifications: unreadCount
    };

    // Emit summary update via socket
    if (io) {
      io.to(`user:${studentId}`).emit('dashboard-summary-update', {
        data: summaryData,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: summaryData
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching dashboard summary', error: error.message });
  }
};

// @desc    Get weekly overview with socket emission
// @route   GET /api/dashboard/weekly
// @access  Private (Student)
export const getWeeklyOverview = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;
    
    const [progress, quizHistory, activity] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let weekActivities = [];
    if (activity && typeof activity.getActivitiesByDateRange === 'function') {
      weekActivities = activity.getActivitiesByDateRange(weekStart, weekEnd) || [];
    } else if (activity?.activities) {
      weekActivities = activity.activities.filter(a => new Date(a.timestamp) >= weekStart && new Date(a.timestamp) <= weekEnd);
    }

    let weekQuizzes = quizHistory?.attempts?.filter(a => 
      a.completedAt && new Date(a.completedAt) >= weekStart && new Date(a.completedAt) <= weekEnd
    ) || [];

    const weeklyData = progress?.weeklyActivity?.find(w => 
      w.week && w.week.year === now.getFullYear() && w.week.week === getWeekNumber(now)
    );

    const weeklyOverviewData = {
      studyTime: weeklyData?.totalStudyTime || 0,
      xpEarned: weeklyData?.totalXpEarned || 0,
      activitiesCount: weekActivities.length,
      quizzesTaken: weekQuizzes.length,
      averageQuizScore: weekQuizzes.length > 0 
        ? weekQuizzes.reduce((sum, q) => sum + (q.score || 0), 0) / weekQuizzes.length 
        : 0,
      dailyBreakdown: weeklyData?.days || [],
      achievements: weekActivities.filter(a => a.type === 'achievement_earned').length,
      topicsCompleted: weekActivities.filter(a => a.type === 'topic_completed').length
    };

    // Emit weekly update via socket
    if (io) {
      io.to(`user:${studentId}`).emit('weekly-overview-update', {
        data: weeklyOverviewData,
        weekStart: weekStart,
        weekEnd: weekEnd,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: weeklyOverviewData
    });
  } catch (error) {
    console.error('Weekly overview error:', error);
    res.status(500).json({ success: false, message: 'Error fetching weekly overview', error: error.message });
  }
};

// @desc    Get today's focus with socket emission
// @route   GET /api/dashboard/today-focus
// @access  Private (Student)
export const getTodayFocus = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;
    
    const [progress, learningPath, mentalState, activity, quizHistory] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      LearningPath.findOne({ studentId }),
      MentalState.findOne({ studentId }),
      Activity.findOne({ studentId }),
      QuizHistory.findOne({ studentId })
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let schedule = { sessions: [], totalMinutes: 0 };
    if (learningPath && typeof learningPath.generateSchedule === 'function') {
      const generated = learningPath.generateSchedule(1);
      if (generated?.[0]) schedule = generated[0];
    }

    const todayStudyTime = (progress && typeof progress.getTodayStudyTime === 'function') 
      ? progress.getTodayStudyTime() 
      : 0;
    const dailyGoal = learningPath?.settings?.dailyGoal || 60;

    let recommendedFocus = [];
    if (mentalState && typeof mentalState.getStudySuggestions === 'function') {
      const suggestions = mentalState.getStudySuggestions();
      if (suggestions?.[0]?.recommendedTopics) recommendedFocus = suggestions[0].recommendedTopics;
    }
    
    if (quizHistory?.statistics?.weakTopics?.length > 0) {
      const weakTopics = quizHistory.statistics.weakTopics.slice(0, 2);
      recommendedFocus = [...recommendedFocus, ...weakTopics.map(w => `Review: ${w.topic}`)];
    }

    const activitiesDone = activity?.activities?.filter(a => 
      a.timestamp && new Date(a.timestamp) >= today && !a.isArchived
    ).length || 0;

    const todayFocusData = {
      schedule: schedule.sessions || [],
      totalPlanned: schedule.totalMinutes || 0,
      completed: todayStudyTime,
      remaining: Math.max(0, dailyGoal - todayStudyTime),
      goal: dailyGoal,
      progress: Math.min(100, (todayStudyTime / dailyGoal) * 100 || 0),
      recommendedFocus,
      mood: mentalState?.currentState?.mood || 'neutral',
      motivation: mentalState?.currentState?.motivationLevel || 'medium',
      activitiesDone
    };

    // Emit today's focus update via socket
    if (io) {
      io.to(`user:${studentId}`).emit('today-focus-update', {
        data: todayFocusData,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: todayFocusData
    });
  } catch (error) {
    console.error('Today focus error:', error);
    res.status(500).json({ success: false, message: "Error fetching today's focus", error: error.message });
  }
};

// @desc    Get insights with socket emission
// @route   GET /api/dashboard/insights
// @access  Private (Student)
export const getInsights = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;
    
    const [progress, quizHistory, mentalState, activity] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      MentalState.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    const insights = [];

    // Learning pattern insights
    if (progress?.weeklyActivity?.length > 0) {
      const studyTrend = progress.weeklyActivity.slice(-4).map(w => w.totalStudyTime || 0);
      if (studyTrend.length >= 2 && studyTrend.every((val, i, arr) => i === 0 || val > arr[i - 1])) {
        insights.push({ 
          type: 'positive', 
          title: 'Consistent Improvement', 
          description: 'Your study time is increasing consistently!', 
          icon: '📈', 
          action: 'Keep it up' 
        });
      } else if (studyTrend.length >= 2 && studyTrend.every((val, i, arr) => i === 0 || val < arr[i - 1])) {
        insights.push({ 
          type: 'suggestion', 
          title: 'Study Time Decreasing', 
          description: 'Your study time has been decreasing. Try to get back on track.', 
          icon: '📉', 
          action: 'Set a daily goal' 
        });
      }
    }

    // Quiz performance insights
    if (quizHistory?.statistics) {
      const stats = quizHistory.statistics;
      const avgScore = stats.averageScore || 0;
      
      if (avgScore > 85) {
        insights.push({ 
          type: 'achievement', 
          title: 'Excellent Performance!', 
          description: `You're averaging ${avgScore.toFixed(1)}% on quizzes!`, 
          icon: '🏆', 
          action: 'Challenge yourself with harder topics' 
        });
      } else if (avgScore > 70) {
        insights.push({ 
          type: 'positive', 
          title: 'Good Progress', 
          description: `You're averaging ${avgScore.toFixed(1)}% on quizzes. Keep going!`, 
          icon: '📊', 
          action: 'Review weak areas' 
        });
      } else if (avgScore < 50 && stats.totalQuizzes > 2) {
        insights.push({ 
          type: 'improvement', 
          title: 'Practice Needed', 
          description: 'Your quiz scores need improvement. Review the material before taking quizzes.', 
          icon: '📚', 
          action: 'Review weak topics' 
        });
      }
      
      if (stats.weakTopics && stats.weakTopics.length > 0) {
        const weakTopicsList = stats.weakTopics.slice(0, 3).map(t => t.topic).join(', ');
        insights.push({ 
          type: 'improvement', 
          title: 'Areas for Growth', 
          description: `Focus on improving: ${weakTopicsList}`, 
          icon: '🎯', 
          action: 'Practice now' 
        });
      }
      
      if (stats.topicsMastered && stats.topicsMastered.length > 0) {
        const masteredTopics = stats.topicsMastered.slice(0, 2).map(t => t.topic).join(', ');
        insights.push({ 
          type: 'positive', 
          title: 'Topics Mastered!', 
          description: `You've mastered ${masteredTopics}`, 
          icon: '⭐', 
          action: 'Share your achievement' 
        });
      }
    }

    // Mental health insights
    if (mentalState?.history?.length > 0) {
      const recentHistory = mentalState.history.slice(-7);
      const positiveMoods = recentHistory.filter(m => 
        m.mood === 'happy' || m.mood === 'energetic'
      ).length;
      const highStress = recentHistory.filter(m => m.stressLevel === 'high').length;
      
      if (positiveMoods / recentHistory.length > 0.6) {
        insights.push({ 
          type: 'positive', 
          title: 'Positive Mood Trend', 
          description: "You've been in a great mood lately! This is excellent for learning.", 
          icon: '😊', 
          action: 'Take on challenges' 
        });
      }
      
      if (highStress > 3) {
        insights.push({ 
          type: 'wellness', 
          title: 'Self-Care Reminder', 
          description: 'Your stress levels have been high. Take time for self-care.', 
          icon: '🧘', 
          action: 'View wellness tips' 
        });
      }
    }

    // Streak insights
    if (progress?.stats?.learningStreak > 0) {
      const streak = progress.stats.learningStreak;
      if (streak >= 30) {
        insights.push({ 
          type: 'achievement', 
          title: `${streak} Day Streak!`, 
          description: `You've been learning for ${streak} days straight! Incredible dedication!`, 
          icon: '🔥', 
          action: 'Keep the streak' 
        });
      } else if (streak >= 7) {
        insights.push({ 
          type: 'achievement', 
          title: `${streak} Day Streak!`, 
          description: `You're on a ${streak}-day learning streak! Consistency is key!`, 
          icon: '⚡', 
          action: 'Maintain momentum' 
        });
      }
    }

    // XP and level insights
    if (progress?.stats?.xpPoints > 0 && progress?.stats?.level) {
      const xpToNextLevel = (progress.stats.level * 100) - progress.stats.xpPoints;
      if (xpToNextLevel < 50 && xpToNextLevel > 0) {
        insights.push({ 
          type: 'motivation', 
          title: 'Almost There!', 
          description: `Just ${xpToNextLevel} XP to reach level ${progress.stats.level + 1}!`, 
          icon: '⭐', 
          action: 'Complete a quick quiz' 
        });
      }
    }

    // Activity insights
    if (activity?.activities?.length > 0) {
      const recentActivities = activity.activities.slice(-14);
      const mostActiveDay = findMostActiveDay(recentActivities);
      if (mostActiveDay) {
        insights.push({ 
          type: 'insight', 
          title: 'Peak Productivity', 
          description: `You're most active on ${mostActiveDay}. Schedule important tasks then!`, 
          icon: '⏰', 
          action: 'Optimize schedule' 
        });
      }
    }

    const insightsData = {
      insights: insights.slice(0, 10),
      totalInsights: insights.length,
      generatedAt: new Date()
    };

    // Emit insights update via socket
    if (io && insights.length > 0) {
      io.to(`user:${studentId}`).emit('insights-update', {
        data: insightsData,
        timestamp: new Date()
      });
    }

    res.json({ 
      success: true, 
      data: insightsData
    });
  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error generating insights', 
      error: error.message 
    });
  }
};

// Helper function to find most active day
function findMostActiveDay(activities) {
  if (!activities || activities.length === 0) return null;
  
  const dayCount = {
    Sunday: 0, Monday: 0, Tuesday: 0, Wednesday: 0,
    Thursday: 0, Friday: 0, Saturday: 0
  };
  
  activities.forEach(activity => {
    const day = new Date(activity.timestamp).toLocaleDateString('en-US', { weekday: 'long' });
    dayCount[day]++;
  });
  
  let maxDay = null;
  let maxCount = 0;
  for (const [day, count] of Object.entries(dayCount)) {
    if (count > maxCount) {
      maxCount = count;
      maxDay = day;
    }
  }
  
  return maxCount > 0 ? maxDay : null;
}

// @desc    Get achievements with socket emission
// @route   GET /api/dashboard/achievements
// @access  Private (Student)
export const getAchievements = async (req, res) => {
  try {
    const studentId = req.user.id;
    const io = req.app.locals.io;
    
    const [progress, quizHistory] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId })
    ]);
    
    const achievements = progress?.achievements || [];
    let newAchievements = [];
    
    // Add quiz-related achievements if not already present
    if (quizHistory?.statistics) {
      const stats = quizHistory.statistics;
      
      if (stats.totalQuizzes === 1 && !achievements.some(a => a.achievementId === 'first_quiz')) {
        const newAchievement = {
          achievementId: 'first_quiz',
          name: 'First Quiz',
          description: 'Completed your first quiz',
          icon: '🏆',
          xpReward: 50,
          earnedAt: new Date()
        };
        achievements.push(newAchievement);
        newAchievements.push(newAchievement);
      }
      
      const hasPerfectScore = quizHistory.attempts?.some(a => a.score === 100);
      if (hasPerfectScore && !achievements.some(a => a.achievementId === 'perfect_score')) {
        const newAchievement = {
          achievementId: 'perfect_score',
          name: 'Perfect Score',
          description: 'Got 100% on a quiz',
          icon: '🌟',
          xpReward: 100,
          earnedAt: new Date()
        };
        achievements.push(newAchievement);
        newAchievements.push(newAchievement);
      }
      
      // Save new achievements if any
      if (newAchievements.length > 0 && progress) {
        progress.achievements = achievements;
        await progress.save();
        
        // Emit new achievements via socket
        if (io) {
          io.to(`user:${studentId}`).emit('achievements-unlocked', {
            achievements: newAchievements,
            totalEarned: achievements.length,
            timestamp: new Date()
          });
        }
      }
    }

    const achievementsData = {
      earned: {
        all: achievements.sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0)),
        recent: achievements.slice(-5)
      },
      totalEarned: achievements.length
    };

    res.json({
      success: true,
      data: achievementsData
    });
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ success: false, message: 'Error fetching achievements', error: error.message });
  }
};

// ============= NEW: Socket-Enhanced Helper Functions =============

// @desc    Get real-time dashboard snapshot for socket
// @route   (Internal function)
export const getDashboardSnapshot = async (studentId) => {
  try {
    const [progress, quizHistory, mentalState, learningPath] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      MentalState.findOne({ studentId }),
      LearningPath.findOne({ studentId })
    ]);
    
    return {
      progress: {
        level: progress?.stats?.level || 1,
        xp: progress?.stats?.xpPoints || 0,
        streak: progress?.stats?.learningStreak || 0,
        completedTopics: progress?.stats?.completedTopics || 0,
        todayStudyTime: progress?.getTodayStudyTime ? progress.getTodayStudyTime() : 0
      },
      quiz: {
        totalQuizzes: quizHistory?.statistics?.totalQuizzes || 0,
        averageScore: quizHistory?.statistics?.averageScore || 0
      },
      mentalState: {
        mood: mentalState?.currentState?.mood || 'neutral',
        stressLevel: mentalState?.currentState?.stressLevel || 'unknown'
      },
      learningPath: {
        hasActivePath: !!learningPath?.currentPath,
        goal: learningPath?.currentPath?.goal || null,
        progress: learningPath?.currentPath?.progress || 0
      },
      timestamp: new Date()
    };
  } catch (error) {
    console.error('Error getting dashboard snapshot:', error);
    return null;
  }
};

// @desc    Broadcast dashboard update to all connected clients of a user
// @route   (Internal function)
export const broadcastDashboardUpdate = async (io, studentId, updateType, updateData) => {
  if (!io) return;
  
  io.to(`user:${studentId}`).emit('dashboard-broadcast', {
    type: updateType,
    data: updateData,
    timestamp: new Date()
  });
  
  // Also trigger full progress update
  await triggerProgressUpdate(io, studentId, 'dashboard_broadcast', updateData);
};