// backend/controllers/progressController.js
import StudentProgress from '../models/StudentProgress.js';
import QuizHistory from '../models/QuizHistory.js';
import Activity from '../models/Activity.js';
import LearningPath from '../models/LearningPath.js';
import Topic from '../models/Topic.js';
import constants from '../config/constants.js';
import { triggerProgressUpdate, emitIncrementalUpdate } from '../config/socket.js';

// @desc    Get user's overall progress
// @route   GET /api/progress/overview
// @access  Private (Student)
export const getProgressOverview = async (req, res) => {
  try {
    const studentId = req.user.id;

    const [progress, quizHistory, learningPath, activity] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      LearningPath.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    if (!progress) {
      return res.json({
        success: true,
        data: {
          stats: {
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
          recentActivity: [],
          achievements: []
        }
      });
    }

    // Calculate additional metrics
    const completedTopics = progress.topicsProgress?.filter(t => t.status === 'completed') || [];
    const inProgressTopics = progress.topicsProgress?.filter(t => t.status === 'in_progress') || [];
    
    // Get topic details for in-progress topics
    const inProgressDetails = await Promise.all(
      inProgressTopics.slice(0, 5).map(async t => {
        const topic = await Topic.findById(t.topicId).select('title category difficulty duration thumbnail');
        return {
          ...t.toObject(),
          details: topic
        };
      })
    );

    // Calculate weekly progress
    const weeklyProgress = progress.weeklyActivity?.slice(-4) || [];

    // Get recent achievements
    const recentAchievements = progress.getRecentAchievements(5);

    // Get today's study time
    const todayStudyTime = progress.getTodayStudyTime();
    const weeklyStudyTime = progress.getWeeklyStudyTime();

    // Calculate next level progress
    const xpForCurrentLevel = (progress.stats.level - 1) * 100;
    const xpForNextLevel = progress.stats.level * 100;
    const xpInCurrentLevel = progress.stats.xpPoints - xpForCurrentLevel;
    const xpNeededForNextLevel = xpForNextLevel - xpForCurrentLevel;
    const progressToNextLevel = (xpInCurrentLevel / xpNeededForNextLevel) * 100;

    const responseData = {
      stats: {
        ...progress.stats.toObject(),
        totalTopics: progress.topicsProgress?.length || 0,
        completedTopics: completedTopics.length,
        inProgressTopics: inProgressTopics.length,
        todayStudyTime,
        weeklyStudyTime,
        xpToNextLevel: Math.ceil(xpNeededForNextLevel - xpInCurrentLevel),
        progressToNextLevel: Math.min(100, progressToNextLevel)
      },
      recentActivity: activity?.getRecentActivities(10) || [],
      inProgress: inProgressDetails,
      achievements: recentAchievements,
      weeklyProgress,
      learningPath: learningPath?.currentPath || null,
      quizStats: quizHistory?.statistics || {
        totalQuizzes: 0,
        averageScore: 0,
        weakTopics: []
      }
    };

    // Emit socket update after sending response
    const io = req.app.locals.io;
    if (io) {
      // Don't await - fire and forget
      triggerProgressUpdate(io, studentId, 'full').catch(err => 
        console.error('Socket emission error:', err)
      );
    }

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get progress overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching progress overview',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get learning streak
// @route   GET /api/progress/streak
// @access  Private (Student)
export const getLearningStreak = async (req, res) => {
  try {
    const studentId = req.user.id;

    const progress = await StudentProgress.findOne({ studentId });

    if (!progress) {
      return res.json({
        success: true,
        data: {
          currentStreak: 0,
          longestStreak: 0,
          streakHistory: [],
          streakFreeze: constants.STREAK.FREEZE_DAYS
        }
      });
    }

    const streakHistory = progress.streakHistory || [];
    const currentStreak = progress.stats.learningStreak || 0;

    // Calculate longest streak
    let longestStreak = currentStreak;
    let tempStreak = 0;
    streakHistory.forEach(day => {
      if (day.studied) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    });

    // Check if streak is at risk
    const lastActive = progress.stats.lastActive;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lastActiveDate = new Date(lastActive);
    lastActiveDate.setHours(0, 0, 0, 0);
    
    const daysSinceLastActive = Math.floor((today - lastActiveDate) / (1000 * 60 * 60 * 24));
    const streakAtRisk = daysSinceLastActive >= 1 && currentStreak > 0;

    const responseData = {
      currentStreak,
      longestStreak,
      streakHistory: streakHistory.slice(-30),
      streakAtRisk,
      daysSinceLastActive: streakAtRisk ? daysSinceLastActive : 0,
      streakFreeze: constants.STREAK.FREEZE_DAYS,
      freezeRemaining: Math.max(0, constants.STREAK.FREEZE_DAYS - daysSinceLastActive + 1)
    };

    // Emit streak update via socket if streak changed
    const io = req.app.locals.io;
    if (io && currentStreak > 0) {
      emitIncrementalUpdate(io, studentId, 'streak_update', {
        currentStreak,
        streakAtRisk,
        daysSinceLastActive: streakAtRisk ? daysSinceLastActive : 0
      }).catch(err => console.error('Streak socket error:', err));
    }

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get streak error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching streak',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};


export const getWeeklyActivity = async (req, res) => {
  try {
    const studentId = req.user.id;
    const progress = await StudentProgress.findOne({ studentId });

    if (!progress || !progress.weeklyActivity || progress.weeklyActivity.length === 0) {
      const defaultWeekly = generateDefaultWeekly();
      return res.json({
        success: true,
        data: defaultWeekly
      });
    }

    // Get current week (last item)
    const currentWeek = progress.weeklyActivity[progress.weeklyActivity.length - 1];
    const previousWeek = progress.weeklyActivity.length > 1 ? progress.weeklyActivity[progress.weeklyActivity.length - 2] : null;

    // Format days for response
    const formattedDays = (currentWeek.days || []).map(day => ({
      date: day.date,
      studyTime: day.studyTime || 0,
      quizzesTaken: day.quizzesTaken || 0,
      topicsCompleted: day.topicsCompleted || 0,
      xpEarned: day.xpEarned || 0,
      dayName: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })
    }));

    // Calculate trend
    let trend = { direction: 'stable', studyTimeChange: 0, xpChange: 0 };
    if (previousWeek && previousWeek.totalStudyTime > 0) {
      const studyTimeChange = ((currentWeek.totalStudyTime - previousWeek.totalStudyTime) / previousWeek.totalStudyTime) * 100;
      trend = {
        direction: studyTimeChange > 10 ? 'up' : studyTimeChange < -10 ? 'down' : 'stable',
        studyTimeChange: studyTimeChange.toFixed(1),
        xpChange: previousWeek.totalXpEarned > 0 
          ? (((currentWeek.totalXpEarned - previousWeek.totalXpEarned) / previousWeek.totalXpEarned) * 100).toFixed(1)
          : 0
      };
    }

    const responseData = {
      currentWeek: {
        days: formattedDays,
        totalStudyTime: currentWeek.totalStudyTime || 0,
        totalXpEarned: currentWeek.totalXpEarned || 0
      },
      previousWeek: previousWeek ? {
        totalStudyTime: previousWeek.totalStudyTime || 0,
        totalXpEarned: previousWeek.totalXpEarned || 0
      } : null,
      trend,
      averageDaily: (currentWeek.totalStudyTime || 0) / 7,
      mostProductiveDay: findMostProductiveDay(formattedDays),
      comparison: previousWeek ? {
        studyTimeChange: previousWeek.totalStudyTime > 0 
          ? (((currentWeek.totalStudyTime || 0) - (previousWeek.totalStudyTime || 0)) / (previousWeek.totalStudyTime || 1) * 100).toFixed(1)
          : 0,
        xpChange: previousWeek.totalXpEarned > 0
          ? (((currentWeek.totalXpEarned || 0) - (previousWeek.totalXpEarned || 0)) / (previousWeek.totalXpEarned || 1) * 100).toFixed(1)
          : 0
      } : null
    };

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get weekly activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching weekly activity',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// Update generateDefaultWeekly to match the expected format
const generateDefaultWeekly = () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const today = new Date();
  const weekDays = [];
  
  // Get start of week (Monday)
  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startOfWeek.setDate(today.getDate() - daysToMonday);
  startOfWeek.setHours(0, 0, 0, 0);
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    weekDays.push({
      date: date,
      studyTime: 0,
      quizzesTaken: 0,
      topicsCompleted: 0,
      xpEarned: 0,
      dayName: days[i]
    });
  }

  return {
    currentWeek: {
      days: weekDays,
      totalStudyTime: 0,
      totalXpEarned: 0
    },
    previousWeek: null,
    trend: { direction: 'stable', studyTimeChange: 0, xpChange: 0 },
    averageDaily: 0,
    mostProductiveDay: null,
    comparison: null
  };
};

const findMostProductiveDay = (days) => {
  if (!days || days.length === 0) return null;

  let mostProductive = null;
  let maxTime = 0;
  
  days.forEach(day => {
    const studyTime = day.studyTime || 0;
    if (studyTime > maxTime) {
      maxTime = studyTime;
      mostProductive = day;
    }
  });

  if (!mostProductive || maxTime === 0) return null;

  return {
    day: mostProductive.dayName,
    studyTime: mostProductive.studyTime,
    date: mostProductive.date
  };
};

// @desc    Get monthly progress
// @route   GET /api/progress/monthly
// @access  Private (Student)
export const getMonthlyProgress = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { year, month } = req.query;

    const targetDate = year && month ? new Date(year, month - 1, 1) : new Date();
    const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

    const progress = await StudentProgress.findOne({ studentId });
    const activity = await Activity.findOne({ studentId });

    if (!progress || !activity) {
      return res.json({
        success: true,
        data: {
          studyTime: 0,
          topicsCompleted: 0,
          quizzesTaken: 0,
          xpEarned: 0,
          dailyBreakdown: []
        }
      });
    }

    const monthActivities = activity.activities.filter(a => {
      const date = new Date(a.timestamp);
      return date >= startOfMonth && date <= endOfMonth;
    });

    const monthlyStats = {
      studyTime: monthActivities.reduce((sum, a) => sum + (a.metadata?.timeSpent || 0), 0),
      topicsCompleted: monthActivities.filter(a => a.type === 'topic_completed').length,
      quizzesTaken: monthActivities.filter(a => a.type === 'quiz_completed').length,
      notesGenerated: monthActivities.filter(a => a.type === 'notes_generated').length,
      xpEarned: monthActivities.reduce((sum, a) => sum + (a.metadata?.xpEarned || 0), 0),
      dailyBreakdown: generateDailyBreakdown(monthActivities, startOfMonth, endOfMonth)
    };

    res.json({
      success: true,
      data: {
        ...monthlyStats,
        month: targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        year: targetDate.getFullYear(),
        month: targetDate.getMonth() + 1
      }
    });

  } catch (error) {
    console.error('Get monthly progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching monthly progress',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get achievements
// @route   GET /api/progress/achievements
// @access  Private (Student)
export const getAchievements = async (req, res) => {
  try {
    const studentId = req.user.id;

    const progress = await StudentProgress.findOne({ studentId });

    const earned = progress?.achievements || [];
    const allAchievements = constants.ACHIEVEMENTS.map(achievement => {
      const earnedAchievement = earned.find(e => e.achievementId === achievement.id);
      
      if (earnedAchievement) {
        return {
          ...achievement,
          earnedAt: earnedAchievement.earnedAt,
          isEarned: true
        };
      } else {
        return {
          ...achievement,
          progress: calculateAchievementProgress(achievement.id, progress),
          isEarned: false
        };
      }
    });
    const grouped = {
      all: allAchievements,
      earned: allAchievements.filter(a => a.isEarned),
      locked: allAchievements.filter(a => !a.isEarned),
      recent: allAchievements
        .filter(a => a.isEarned)
        .sort((a, b) => b.earnedAt - a.earnedAt)
        .slice(0, 5)
    };

    const stats = {
      totalEarned: grouped.earned.length,
      totalAvailable: allAchievements.length,
      completionPercentage: (grouped.earned.length / allAchievements.length * 100).toFixed(1),
      totalXpFromAchievements: grouped.earned.reduce((sum, a) => sum + (a.xpReward || 0), 0)
    };

    // Emit achievement update if new achievement earned
    const io = req.app.locals.io;
    if (io && grouped.recent.length > 0 && progress?.lastAchievementCheck !== grouped.recent[0]?.earnedAt) {
      const newestAchievement = grouped.recent[0];
      if (newestAchievement && newestAchievement.isEarned) {
        emitIncrementalUpdate(io, studentId, 'achievement_earned', {
          achievement: newestAchievement,
          totalEarned: grouped.earned.length,
          completionPercentage: stats.completionPercentage
        }).catch(err => console.error('Achievement socket error:', err));
        
        // Mark as checked
        if (progress) {
          progress.lastAchievementCheck = new Date();
          await progress.save();
        }
      }
    }

    res.json({
      success: true,
      data: {
        achievements: grouped,
        stats,
        nextAchievement: grouped.locked[0] || null
      }
    });

  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching achievements',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get learning insights
// @route   GET /api/progress/insights
// @access  Private (Student)
export const getLearningInsights = async (req, res) => {
  try {
    const studentId = req.user.id;

    const [progress, quizHistory, activity] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    const insights = [];
    if (progress && progress.weeklyActivity.length > 0) {
      const weeklyTrend = analyzeWeeklyTrend(progress.weeklyActivity);
      if (weeklyTrend) insights.push(weeklyTrend);
    }
    if (quizHistory && quizHistory.statistics.totalQuizzes > 0) {
      const quizInsights = analyzeQuizPerformance(quizHistory);
      insights.push(...quizInsights);
    }
    if (activity) {
      const activityInsights = analyzeActivityPatterns(activity);
      insights.push(...activityInsights);
    }
    if (progress && progress.stats.totalStudyTime > 0) {
      const timeInsights = analyzeTimeManagement(progress);
      insights.push(...timeInsights);
    }

    // Emit insights update via socket if there are important insights
    const io = req.app.locals.io;
    if (io && insights.length > 0) {
      const criticalInsights = insights.filter(i => i.type === 'suggestion' || i.type === 'warning');
      if (criticalInsights.length > 0) {
        emitIncrementalUpdate(io, studentId, 'critical_insights', {
          insights: criticalInsights,
          totalInsights: insights.length
        }).catch(err => console.error('Insights socket error:', err));
      }
    }

    res.json({
      success: true,
      data: {
        insights: insights.slice(0, 10),
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating insights',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ============= NEW: Socket-Enhanced Helper Functions =============

// @desc    Update streak and emit real-time update
// @route   (Internal function)
export const updateStreakAndEmit = async (studentId, io) => {
  try {
    const progress = await StudentProgress.findOne({ studentId });
    if (!progress) return { updated: false };
    
    const oldStreak = progress.stats.learningStreak || 0;
    
    if (typeof progress.updateStreak === 'function') {
      progress.updateStreak();
      await progress.save();
      
      const newStreak = progress.stats.learningStreak || 0;
      
      if (oldStreak !== newStreak && io) {
        await emitIncrementalUpdate(io, studentId, 'streak_update', {
          oldStreak,
          newStreak,
          increased: newStreak > oldStreak,
          message: newStreak > oldStreak 
            ? `🔥 ${newStreak} day streak! Keep going!` 
            : `Streak reset to ${newStreak}. Start fresh tomorrow!`
        });
        
        return { updated: true, oldStreak, newStreak };
      }
    }
    
    return { updated: false };
  } catch (error) {
    console.error('Error updating streak:', error);
    return { updated: false, error: error.message };
  }
};

// @desc    Check and emit level up updates
// @route   (Internal function)
export const checkLevelUpAndEmit = async (studentId, io, xpGained = 0) => {
  try {
    const progress = await StudentProgress.findOne({ studentId });
    if (!progress) return { leveledUp: false };
    
    const oldLevel = progress.stats.level || 1;
    const oldXP = progress.stats.xpPoints || 0;
    const newXP = oldXP + xpGained;
    
    // Level formula: Level = 1 + floor(XP / 100)
    const newLevel = 1 + Math.floor(newXP / 100);
    
    if (newLevel > oldLevel && io) {
      await emitIncrementalUpdate(io, studentId, 'level_up', {
        oldLevel,
        newLevel,
        xpGained,
        totalXP: newXP,
        message: `🎉 Congratulations! You've reached Level ${newLevel}!`
      });
      
      return { leveledUp: true, oldLevel, newLevel };
    }
    
    return { leveledUp: false };
  } catch (error) {
    console.error('Error checking level up:', error);
    return { leveledUp: false, error: error.message };
  }
};

// @desc    Get real-time progress snapshot for socket
// @route   (Internal function)
export const getProgressSnapshot = async (studentId) => {
  try {
    const [progress, quizHistory] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId })
    ]);
    
    if (!progress) {
      return {
        level: 1,
        xp: 0,
        streak: 0,
        completedTopics: 0,
        averageScore: 0
      };
    }
    
    return {
      level: progress.stats.level || 1,
      xp: progress.stats.xpPoints || 0,
      streak: progress.stats.learningStreak || 0,
      completedTopics: progress.stats.completedTopics || 0,
      averageScore: progress.stats.averageScore || 0,
      quizzesTaken: progress.stats.quizzesTaken || 0
    };
  } catch (error) {
    console.error('Error getting progress snapshot:', error);
    return null;
  }
};

// ============= EXISTING HELPER FUNCTIONS =============


const calculateWeeklyTrend = (current, previous) => {
  if (!previous) return { direction: 'stable', percentage: 0 };

  const studyTimeChange = ((current.totalStudyTime - previous.totalStudyTime) / previous.totalStudyTime) * 100;
  const xpChange = ((current.totalXpEarned - previous.totalXpEarned) / previous.totalXpEarned) * 100;

  let direction = 'stable';
  if (studyTimeChange > 10 || xpChange > 10) direction = 'up';
  else if (studyTimeChange < -10 || xpChange < -10) direction = 'down';

  return {
    direction,
    studyTimeChange: studyTimeChange.toFixed(1),
    xpChange: xpChange.toFixed(1)
  };
};

// const findMostProductiveDay = (days) => {
//   if (!days || days.length === 0) return null;

//   const mostProductive = days.reduce((max, day) => 
//     day.studyTime > (max?.studyTime || 0) ? day : max
//   , days[0]);

//   return {
//     day: new Date(mostProductive.date).toLocaleDateString('en-US', { weekday: 'long' }),
//     studyTime: mostProductive.studyTime,
//     date: mostProductive.date
//   };
// };


const generateDailyBreakdown = (activities, startDate, endDate) => {
  const breakdown = {};
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    breakdown[dateStr] = {
      date: new Date(d),
      count: 0,
      studyTime: 0,
      xpEarned: 0
    };
  }

  activities.forEach(activity => {
    const dateStr = new Date(activity.timestamp).toISOString().split('T')[0];
    if (breakdown[dateStr]) {
      breakdown[dateStr].count++;
      breakdown[dateStr].studyTime += activity.metadata?.timeSpent || 0;
      breakdown[dateStr].xpEarned += activity.metadata?.xpEarned || 0;
    }
  });

  return Object.values(breakdown);
};

const calculateAchievementProgress = (achievementId, progress) => {
  if (!progress) return 0;

  switch (achievementId) {
    case 'first_quiz':
      return progress.stats.quizzesTaken >= 1 ? 100 : (progress.stats.quizzesTaken / 1) * 100;
    case 'seven_day_streak':
      return Math.min(100, (progress.stats.learningStreak / 7) * 100);
    case 'thirty_day_streak':
      return Math.min(100, (progress.stats.learningStreak / 30) * 100);
    case 'five_topics':
      return Math.min(100, (progress.stats.completedTopics / 5) * 100);
    case 'ten_topics':
      return Math.min(100, (progress.stats.completedTopics / 10) * 100);
    case 'perfect_score':
      return 0;
    default:
      return 0;
  }
};

const analyzeWeeklyTrend = (weeklyActivity) => {
  if (weeklyActivity.length < 2) return null;

  const lastTwo = weeklyActivity.slice(-2);
  const prev = lastTwo[0];
  const curr = lastTwo[1];

  const increase = curr.totalStudyTime > prev.totalStudyTime * 1.2;
  const decrease = curr.totalStudyTime < prev.totalStudyTime * 0.8;

  if (increase) {
    return {
      type: 'positive',
      title: 'Study Time Increasing',
      description: `You studied ${((curr.totalStudyTime - prev.totalStudyTime) / prev.totalStudyTime * 100).toFixed(0)}% more this week!`,
      icon: '📈'
    };
  } else if (decrease) {
    return {
      type: 'suggestion',
      title: 'Study Time Decreasing',
      description: 'Your study time dropped this week. Try to get back on track.',
      icon: '📉'
    };
  }

  return null;
};

const analyzeQuizPerformance = (quizHistory) => {
  const insights = [];
  const stats = quizHistory.statistics;

  if (stats.averageScore > 80) {
    insights.push({
      type: 'positive',
      title: 'Excellent Quiz Performance',
      description: `You're averaging ${stats.averageScore.toFixed(1)}% on quizzes!`,
      icon: '🏆'
    });
  } else if (stats.averageScore < 60) {
    insights.push({
      type: 'suggestion',
      title: 'Quiz Scores Need Improvement',
      description: 'Focus on reviewing the material before taking quizzes.',
      icon: '📚'
    });
  }

  if (stats.weakTopics && stats.weakTopics.length > 0) {
    insights.push({
      type: 'info',
      title: 'Areas to Focus',
      description: `Spend more time on: ${stats.weakTopics.slice(0, 3).map(t => t.topic).join(', ')}`,
      icon: '🎯'
    });
  }

  return insights;
};

const analyzeActivityPatterns = (activity) => {
  const insights = [];
  const activities = activity.activities || [];

  if (activities.length < 10) return insights;

  const hourCounts = {};
  activities.forEach(a => {
    const hour = new Date(a.timestamp).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });

  const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  if (bestHour) {
    const hour = parseInt(bestHour[0]);
    const timeStr = hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
    
    insights.push({
      type: 'insight',
      title: 'Peak Activity Time',
      description: `You're most active around ${timeStr}. Schedule important tasks then.`,
      icon: '⏰'
    });
  }

  const dailyCounts = {};
  activities.forEach(a => {
    const date = new Date(a.timestamp).toDateString();
    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
  });

  const activeDays = Object.keys(dailyCounts).length;
  const totalDays = 30;
  const consistency = (activeDays / totalDays) * 100;

  if (consistency > 70) {
    insights.push({
      type: 'positive',
      title: 'Great Consistency',
      description: `You've been active on ${activeDays} out of the last 30 days!`,
      icon: '🔥'
    });
  } else if (consistency < 30) {
    insights.push({
      type: 'suggestion',
      title: 'Build Consistency',
      description: 'Try to study a little bit each day to build momentum.',
      icon: '💪'
    });
  }

  return insights;
};

const analyzeTimeManagement = (progress) => {
  const insights = [];
  const stats = progress.stats;

  if (stats.totalStudyTime > 0) {
    const avgDaily = stats.totalStudyTime / (stats.learningStreak || 1);
    
    if (avgDaily > 120) {
      insights.push({
        type: 'positive',
        title: 'Dedicated Learner',
        description: `You average ${Math.round(avgDaily)} minutes of study per day!`,
        icon: '⭐'
      });
    } else if (avgDaily < 30) {
      insights.push({
        type: 'suggestion',
        title: 'Increase Study Time',
        description: 'Try to study at least 30 minutes each day for better progress.',
        icon: '⏳'
      });
    }
  }

  return insights;
};

// backend/controllers/progressController.js

// @desc    Get aggregated progress summary (ONE CALL for all data)
// @route   GET /api/progress/summary
// @access  Private (Student)
export const getProgressSummary = async (req, res) => {
  try {
    const studentId = req.user.id;

    const [progress, quizHistory, activity] = await Promise.all([
      StudentProgress.findOne({ studentId }),
      QuizHistory.findOne({ studentId }),
      Activity.findOne({ studentId })
    ]);

    if (!progress) {
      return res.json({
        success: true,
        data: {
          stats: {
            level: 1,
            xp: 0,
            xpToNextLevel: 100,
            progressToNextLevel: 0,
            learningStreak: 0,
            totalStudyTime: 0,
            completedTopics: 0,
            totalTopics: 0,
            inProgressTopics: 0,
            todayStudyTime: 0,
            weeklyStudyTime: 0,
            quizzesTaken: 0,
            averageScore: 0
          },
          quizStats: {
            totalQuizzes: 0,
            averageScore: 0,
            bestScore: 0,
            weakTopics: [],
            topicsMastered: []
          },
          recentActivity: [],
          achievements: [],
          weeklyActivity: [],
          insights: []
        }
      });
    }

    // Calculate XP to next level (100 XP per level)
    const currentLevelXP = (progress.stats.level - 1) * 100;
    const xpInCurrentLevel = progress.stats.xpPoints - currentLevelXP;
    const xpToNextLevel = 100 - xpInCurrentLevel;
    const progressToNextLevel = Math.min(100, (xpInCurrentLevel / 100) * 100);

    // Get quiz statistics from QuizHistory
    const quizStats = quizHistory?.statistics || {
      totalQuizzes: 0,
      averageScore: 0,
      bestScore: 0,
      weakTopics: [],
      topicsMastered: []
    };

    // Get today's and weekly study time from progress model methods
    const todayStudyTime = progress.getTodayStudyTime?.() || 0;
    const weeklyStudyTime = progress.getWeeklyStudyTime?.() || 0;

    // Calculate in-progress topics
    const inProgressTopics = progress.topicsProgress?.filter(t => t.status === 'in_progress').length || 0;

    // Get recent activities
    let recentActivities = [];
    if (activity && activity.activities) {
      recentActivities = activity.activities.slice(-10).map(a => ({
        id: a._id,
        type: a.type,
        title: a.title,
        description: a.description,
        timestamp: a.timestamp,
        icon: a.icon || (a.type === 'quiz_completed' ? '📝' : a.type === 'topic_completed' ? '✅' : '📌')
      }));
    }

    // Get achievements
    const achievements = progress.getRecentAchievements?.(5) || progress.achievements?.slice(-5) || [];

    // ✅ FIX: Calculate weekly scores from quiz history
    let weeklyActivityData = [];
    
    // Get quiz attempts from last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      last7Days.push({
        date,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        scores: [],
        studyTime: 0,
        quizzesCount: 0
      });
    }
    
    // Collect quiz scores from quiz history
    if (quizHistory && quizHistory.attempts) {
      quizHistory.attempts.forEach(attempt => {
        const attemptDate = new Date(attempt.completedAt);
        attemptDate.setHours(0, 0, 0, 0);
        
        const dayData = last7Days.find(d => d.date.getTime() === attemptDate.getTime());
        if (dayData) {
          dayData.scores.push(attempt.score);
          dayData.quizzesCount++;
        }
      });
    }
    
    // Also get study time from weekly activity
    if (progress.weeklyActivity && progress.weeklyActivity.length > 0) {
      const currentWeek = progress.weeklyActivity[progress.weeklyActivity.length - 1];
      if (currentWeek && currentWeek.days) {
        currentWeek.days.forEach(day => {
          const dayDate = new Date(day.date);
          dayDate.setHours(0, 0, 0, 0);
          
          const dayData = last7Days.find(d => d.date.getTime() === dayDate.getTime());
          if (dayData) {
            dayData.studyTime = day.studyTime || 0;
          }
        });
      }
    }
    
    // Calculate average score for each day
    weeklyActivityData = last7Days.map(day => {
      const avgScore = day.scores.length > 0 
        ? day.scores.reduce((a, b) => a + b, 0) / day.scores.length 
        : 0;
      
      return {
        day: day.dayName,
        studyTime: day.studyTime,
        score: Math.round(avgScore),
        quizzesTaken: day.quizzesCount
      };
    });

    // Generate insights based on actual data
    const insights = [];
    
    if (progress.stats.learningStreak >= 7) {
      insights.push({
        type: 'positive',
        title: '🔥 Amazing Streak!',
        description: `You've maintained a ${progress.stats.learningStreak}-day learning streak! Keep it up!`,
        icon: '🔥'
      });
    } else if (progress.stats.learningStreak >= 3) {
      insights.push({
        type: 'motivation',
        title: '⚡ Building Momentum',
        description: `${progress.stats.learningStreak} day streak! ${7 - progress.stats.learningStreak} more days to reach weekly milestone.`,
        icon: '⚡'
      });
    }
    
    if (quizStats.averageScore > 80 && quizStats.totalQuizzes > 0) {
      insights.push({
        type: 'positive',
        title: '🎯 Quiz Master!',
        description: `Your average score of ${Math.round(quizStats.averageScore)}% is excellent!`,
        icon: '🏆'
      });
    } else if (quizStats.averageScore < 60 && quizStats.totalQuizzes > 2) {
      insights.push({
        type: 'improvement',
        title: '📚 Focus Needed',
        description: 'Review weak topics to improve quiz scores.',
        icon: '🎯'
      });
    }
    
    if (quizStats.weakTopics && quizStats.weakTopics.length > 0) {
      insights.push({
        type: 'action',
        title: '💡 Smart Practice',
        description: `Focus on: ${quizStats.weakTopics.slice(0, 3).map(w => w.topic).join(', ')}`,
        icon: '📖'
      });
    }
    
    if (progress.stats.completedTopics === 0 && progress.stats.totalTopics === 0) {
      insights.push({
        type: 'neutral',
        title: '🚀 Start Your Journey',
        description: 'Discover topics and create your first learning path!',
        icon: '🚀'
      });
    }

    res.json({
      success: true,
      data: {
        stats: {
          level: progress.stats.level,
          xp: progress.stats.xpPoints,
          xpToNextLevel,
          progressToNextLevel,
          learningStreak: progress.stats.learningStreak,
          totalStudyTime: progress.stats.totalStudyTime,
          completedTopics: progress.stats.completedTopics,
          totalTopics: progress.stats.totalTopics,
          inProgressTopics,
          todayStudyTime,
          weeklyStudyTime,
          quizzesTaken: progress.stats.quizzesTaken,
          averageScore: Math.round(progress.stats.averageScore || 0)
        },
        quizStats: {
          totalQuizzes: quizStats.totalQuizzes,
          averageScore: Math.round(quizStats.averageScore || 0),
          bestScore: quizStats.bestScore || 0,
          weakTopics: quizStats.weakTopics || [],
          topicsMastered: quizStats.topicsMastered || []
        },
        recentActivity: recentActivities,
        achievements: achievements,
        weeklyActivity: weeklyActivityData,
        insights: insights,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('Get progress summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching progress summary',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};


// backend/controllers/progressController.js
// Add this temporary test endpoint

export const testAddStudyTime = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { minutes } = req.body;
    
    const progress = await StudentProgress.findOne({ studentId });
    if (!progress) {
      return res.status(404).json({ success: false, message: 'Progress not found' });
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const weekNumber = getWeekNumber(now);
    
    // Find or create week data
    let weekData = progress.weeklyActivity.find(
      w => w.week && w.week.year === year && w.week.week === weekNumber
    );
    
    if (!weekData) {
      weekData = {
        week: { year, week: weekNumber },
        days: [],
        totalStudyTime: 0,
        totalXpEarned: 0
      };
      progress.weeklyActivity.push(weekData);
    }
    
    // Find or create today's entry
    const todayStr = now.toDateString();
    let todayEntry = weekData.days.find(day => 
      day.date && new Date(day.date).toDateString() === todayStr
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
    
    todayEntry.studyTime = (todayEntry.studyTime || 0) + minutes;
    weekData.totalStudyTime = (weekData.totalStudyTime || 0) + minutes;
    
    await progress.save();
    
    res.json({ 
      success: true, 
      message: `Added ${minutes} minutes successfully`,
      data: {
        todayStudyTime: todayEntry.studyTime,
        weekTotal: weekData.totalStudyTime,
        weekNumber,
        year
      }
    });
    
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add this helper function at the top
const getWeekNumber = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};