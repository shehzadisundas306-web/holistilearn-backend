// backend/controllers/quizController.js
import Quiz from '../models/Quiz.js';
import QuizHistory from '../models/QuizHistory.js';
import StudentProgress from '../models/StudentProgress.js';
import Activity from '../models/Activity.js';
import MentalState from '../models/MentalState.js';
import LearningPath from '../models/LearningPath.js';
import constants from '../config/constants.js';
import aiService from '../services/aiService.js';
import mongoose from 'mongoose';
import Enrollment from '../models/Enrollment.js';
import { triggerProgressUpdate, emitIncrementalUpdate } from '../config/socket.js';
import NotificationService from '../services/notificationService.js'; // ✅ ADD THIS

// ============= HELPER FUNCTIONS =============

const getTopCategories = (categories, limit = 5) => {
  if (!categories || categories.length === 0) return [];
  
  const counts = {};
  categories.forEach(cat => {
    let categoryName = 'General';
    
    if (typeof cat === 'string') {
      categoryName = cat;
    } else if (cat && typeof cat === 'object') {
      if (cat.category) categoryName = cat.category;
      else if (cat.topic) categoryName = cat.topic;
      else if (cat.name) categoryName = cat.name;
      else {
        const stringValue = Object.values(cat).find(v => typeof v === 'string');
        if (stringValue) categoryName = stringValue;
      }
    }
    
    counts[categoryName] = (counts[categoryName] || 0) + 1;
  });
  
  const result = Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return result;
};

const getScoreFeedback = (score) => {
  if (score >= 90) {
    return {
      message: 'Excellent! You\'ve mastered this topic!',
      emoji: '🌟',
      tip: 'Try more advanced topics to challenge yourself.'
    };
  } else if (score >= 70) {
    return {
      message: 'Good job! You have a solid understanding.',
      emoji: '👍',
      tip: 'Review the questions you missed to strengthen your knowledge.'
    };
  } else if (score >= 50) {
    return {
      message: 'You\'re on the right track! Keep practicing.',
      emoji: '💪',
      tip: 'Focus on the areas where you struggled and try again.'
    };
  } else {
    return {
      message: 'Don\'t give up! Practice makes perfect.',
      emoji: '📚',
      tip: 'Review the material and try this quiz again.'
    };
  }
};

// ============= WEEKLY STUDY TIME HELPERS =============

const getWeekNumber = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

const updateWeeklyStudyTime = async (studentId, minutes) => {
  try {
    
    const progress = await StudentProgress.findOne({ studentId });
    if (!progress) {
      return false;
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const weekNumber = getWeekNumber(now);
    
    let weekData = progress.weeklyActivity?.find(
      w => w.week?.year === year && w.week?.week === weekNumber
    );
    
    if (!weekData) {
      weekData = {
        week: { year, week: weekNumber },
        days: [],
        totalStudyTime: 0,
        totalXpEarned: 0
      };
      if (!progress.weeklyActivity) progress.weeklyActivity = [];
      progress.weeklyActivity.push(weekData);
    }
    
    const todayStr = now.toDateString();
    let todayEntry = weekData.days.find(day => 
      new Date(day.date).toDateString() === todayStr
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
    
    if (progress.weeklyActivity.length > 12) {
      progress.weeklyActivity = progress.weeklyActivity.slice(-12);
    }
    
    await progress.save();
    return true;
    
  } catch (error) {
    console.error('Error updating weekly study time:', error);
    return false;
  }
};

// ============= QUIZ CONTROLLER FUNCTIONS =============

export const getQuizzesByTopic = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { difficulty } = req.query;

    const filter = { topic: topicId };
    if (difficulty) filter.difficulty = difficulty;

    const quizzes = await Quiz.find(filter)
      .select('-questions.correctAnswer')
      .populate('createdBy', 'name');

    const sanitizedQuizzes = quizzes.map(quiz => ({
      ...quiz.toObject(),
      questions: quiz.questions.map(q => ({
        _id: q._id,
        question: q.question,
        options: q.options,
        explanation: q.explanation,
        points: q.points,
        difficulty: q.difficulty
      }))
    }));

    res.json({
      success: true,
      count: sanitizedQuizzes.length,
      data: sanitizedQuizzes
    });

  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quizzes',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const getQuizById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (id.startsWith('temp-') || id.startsWith('fallback-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID. Please generate a new quiz.',
        isTemporary: true
      });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const quiz = await Quiz.findById(id)
      .populate('createdBy', 'name');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    const sanitizedQuiz = {
      _id: quiz._id,
      title: quiz.title,
      topic: quiz.topic,
      difficulty: quiz.difficulty,
      timeLimit: quiz.timeLimit,
      questions: quiz.questions.map(q => ({
        _id: q._id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        points: q.points,
        difficulty: q.difficulty
      })),
      createdAt: quiz.createdAt,
      createdBy: quiz.createdBy
    };

    res.json({
      success: true,
      data: sanitizedQuiz
    });

  } catch (error) {
    console.error('Get quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const submitQuiz = async (req, res) => {
  try {
    const { answers, timeSpent, mentalStateSnapshot } = req.body;
    const studentId = req.user.id;
    const quizId = req.params.quizId || req.params.id;

    const io = req.app.locals.io;

    if (!mongoose.Types.ObjectId.isValid(quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const quiz = await Quiz.findById(quizId);
    
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    if (!answers || answers.length !== quiz.questions.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid answers format'
      });
    }

    let correctAnswers = 0;
    const questionResults = [];
    const strengths = [];
    const weaknesses = [];

    quiz.questions.forEach((question, index) => {
      const userAnswer = answers[index];
      const isCorrect = userAnswer === question.correctAnswer;
      
      if (isCorrect) correctAnswers++;

      questionResults.push({
        questionId: question._id,
        question: question.question,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        explanation: question.explanation,
        difficulty: question.difficulty
      });

      const category = question.category || quiz.topic || 'general';
      if (isCorrect) {
        strengths.push(category);
      } else {
        weaknesses.push(category);
      }
    });

    const totalQuestions = quiz.questions.length;
    const score = (correctAnswers / totalQuestions) * 100;

    const mentalState = await MentalState.findOne({ studentId });

    const attempt = {
      quizId: quiz._id,
      topic: quiz.topic,
      title: quiz.title,
      score,
      totalQuestions,
      correctAnswers,
      incorrectAnswers: totalQuestions - correctAnswers,
      timeSpent: timeSpent || 0,
      difficulty: quiz.difficulty,
      questions: questionResults,
      strengths: getTopCategories(strengths),
      weaknesses: getTopCategories(weaknesses),
      mentalStateAtTime: mentalStateSnapshot || mentalState?.currentState || {
        stressLevel: 'unknown',
        motivationLevel: 'unknown',
        energyLevel: 'unknown',
        focusLevel: 'unknown',
        mood: 'neutral'
      },
      completedAt: new Date()
    };

    let quizHistory = await QuizHistory.findOne({ studentId });
    let previousStats = null;
    
    if (!quizHistory) {
      quizHistory = new QuizHistory({ 
        studentId, 
        attempts: [],
        statistics: {
          totalQuizzes: 0,
          averageScore: 0,
          bestScore: 0,
          worstScore: 100,
          totalTimeSpent: 0,
          weakTopics: [],
          topicsMastered: []
        }
      });
    } else {
      previousStats = { ...quizHistory.statistics };
    }

    quizHistory.attempts.push(attempt);
    
    const stats = quizHistory.statistics;
    stats.totalQuizzes += 1;
    stats.averageScore = (stats.averageScore * (stats.totalQuizzes - 1) + score) / stats.totalQuizzes;
    stats.bestScore = Math.max(stats.bestScore || 0, score);
    stats.worstScore = Math.min(stats.worstScore || 100, score);
    stats.totalTimeSpent = (stats.totalTimeSpent || 0) + (timeSpent || 0);
    
    const weakTopicsCount = {};
    const masteredTopicsCount = {};
    
    weaknesses.forEach(topic => {
      weakTopicsCount[topic] = (weakTopicsCount[topic] || 0) + 1;
    });
    
    strengths.forEach(topic => {
      masteredTopicsCount[topic] = (masteredTopicsCount[topic] || 0) + 1;
    });
    
    stats.weakTopics = Object.entries(weakTopicsCount)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
      
    stats.topicsMastered = Object.entries(masteredTopicsCount)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    await quizHistory.save();

    const progress = await StudentProgress.findOne({ studentId });
    let xpEarned = 0;
    let oldLevel = 1;
    let newLevel = 1;
    
    if (progress) {
      oldLevel = progress.stats.level || 1;
      
      if (!progress.stats) progress.stats = {};
      progress.stats.quizzesTaken = (progress.stats.quizzesTaken || 0) + 1;
      progress.stats.averageScore = 
        ((progress.stats.averageScore || 0) * (progress.stats.quizzesTaken - 1) + score) / 
        progress.stats.quizzesTaken;
      
      xpEarned = Math.round(score * 1.5);
      progress.stats.xpPoints = (progress.stats.xpPoints || 0) + xpEarned;
      
      newLevel = 1 + Math.floor(progress.stats.xpPoints / 500);
      
      if (typeof progress.updateStreak === 'function') {
        progress.updateStreak();
      }
      await progress.save();
    }

    if (timeSpent && timeSpent > 0) {
      const minutes = Math.ceil(timeSpent / 60);
      await updateWeeklyStudyTime(studentId, minutes);
    }

    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'quiz_completed',
            title: `Quiz Completed: ${quiz.title}`,
            description: `Scored ${score.toFixed(1)}% on ${quiz.topic}`,
            metadata: {
              topic: quiz.topic,
              quizId: quiz._id,
              score,
              totalQuestions,
              correctAnswers,
              timeSpent,
              xpEarned
            },
            icon: score >= 80 ? '🏆' : score >= 60 ? '📝' : '📚',
            color: score >= 80 ? '#f59e0b' : score >= 60 ? '#10b981' : '#3b82f6',
            importance: score >= 80 ? 'high' : 'medium',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    // ============ SAVE SUBMISSION TO QUIZ DOCUMENT (FOR TEACHER VIEW) ============
    if (quiz.quizType === 'class') {
      try {
        if (!quiz.submissions) {
          quiz.submissions = [];
        }
        
        quiz.submissions.push({
          studentId: studentId,
          score: score,
          percentage: score,
          submittedAt: new Date(),
          answers: answers,
          correctAnswers: correctAnswers,
          totalQuestions: totalQuestions,
          timeSpent: timeSpent || 0
        });
        
        await quiz.save();
      } catch (submissionError) {
        console.error('Error saving submission to quiz:', submissionError);
      }
    }

    // ============ SOCKET.IO EMISSIONS ============
    
    const notificationService = new NotificationService(io);
    const User = mongoose.model('User');
    
    if (io) {
      io.to(`user:${studentId}`).emit('quiz-completed', {
        quizId: quiz._id,
        topic: quiz.topic,
        title: quiz.title,
        score,
        percentage: score.toFixed(1),
        passed: score >= 70,
        xpEarned,
        correctAnswers,
        totalQuestions,
        timeSpent,
        timestamp: new Date()
      });
      
      await emitIncrementalUpdate(io, studentId, 'quiz_score', {
        quizId: quiz._id,
        topic: quiz.topic,
        score,
        previousAverage: previousStats?.averageScore || 0,
        newAverage: stats.averageScore,
        improvement: stats.averageScore - (previousStats?.averageScore || 0)
      });
      
      if (score === 100) {
        io.to(`user:${studentId}`).emit('perfect-score', {
          quizId: quiz._id,
          topic: quiz.topic,
          message: '🎉 Perfect Score! Amazing job!',
          xpBonus: 50,
          timestamp: new Date()
        });
      }
      
      const newWeakTopics = stats.weakTopics?.filter(wt => 
        !previousStats?.weakTopics?.some(pwt => pwt.topic === wt.topic)
      );
      
      if (newWeakTopics && newWeakTopics.length > 0) {
        io.to(`user:${studentId}`).emit('weak-topics-update', {
          newWeakTopics,
          message: `New areas to focus: ${newWeakTopics.map(w => w.topic).join(', ')}`,
          timestamp: new Date()
        });
      }
      
      const newMasteredTopics = stats.topicsMastered?.filter(mt => 
        !previousStats?.topicsMastered?.some(pmt => pmt.topic === mt.topic)
      );
      
      if (newMasteredTopics && newMasteredTopics.length > 0) {
        io.to(`user:${studentId}`).emit('topics-mastered', {
          newMasteredTopics,
          message: `🎓 You've mastered: ${newMasteredTopics.map(m => m.topic).join(', ')}!`,
          timestamp: new Date()
        });
      }
      
      if (newLevel > oldLevel) {
        io.to(`user:${studentId}`).emit('level-up', {
          oldLevel,
          newLevel,
          xpEarned,
          totalXP: progress?.stats.xpPoints,
          message: `🎉 Congratulations! You've reached Level ${newLevel}!`,
          timestamp: new Date()
        });
      }
      
      io.to(`user:${studentId}`).emit('xp-earned', {
        amount: xpEarned,
        source: 'quiz',
        quizTitle: quiz.title,
        totalXP: progress?.stats.xpPoints,
        timestamp: new Date()
      });
      
      await triggerProgressUpdate(io, studentId, 'quiz_submitted', {
        score,
        xpEarned,
        quizTitle: quiz.title
      });
    }

    // ============ NOTIFY TEACHER FOR CLASS QUIZ (ENHANCED) ============
    if (quiz.quizType === 'class' && quiz.classId) {
      try {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(quiz.classId);
        
        if (classData && classData.teacherId && io) {
          const student = await User.findById(studentId).select('name username');
          const studentName = student?.name || student?.username || 'Student';
          const scorePercentage = score.toFixed(1);
          
          // Socket emit for real-time
          io.to(`teacher:${classData.teacherId}`).emit('quiz:submitted', {
            quizId: quiz._id,
            quizTitle: quiz.title,
            className: classData.className,
            studentName: studentName,
            score: score,
            percentage: scorePercentage,
            timestamp: new Date()
          });
          
          // ✅ Enhanced notification via NotificationService
          await notificationService.sendToTeacher(quiz.classId, {
            type: 'quiz_submitted',
            title: '📊 Quiz Submitted!',
            message: `${studentName} submitted "${quiz.title}" with ${scorePercentage}%`,
            link: `/teacher/dashboard/quiz/${quiz._id}?mode=results`,
            icon: '📊',
            color: score >= 70 ? '#10b981' : '#f59e0b',
            priority: 'high',
            data: {
              quizId: quiz._id,
              quizTitle: quiz.title,
              studentId: studentId,
              studentName: studentName,
              score: score,
              percentage: scorePercentage,
              className: classData.className,
              submittedAt: new Date()
            }
          });
        }
      } catch (notifyError) {
        console.error('Error notifying teacher:', notifyError);
      }
    }
    
    // ============ END SOCKET EMISSIONS ============

    const result = {
      score,
      correctAnswers,
      totalQuestions,
      percentage: score.toFixed(1),
      passed: score >= 70,
      timeSpent,
      xpEarned,
      feedback: getScoreFeedback(score),
      strengths: getTopCategories(strengths, 3),
      weaknesses: getTopCategories(weaknesses, 3),
      questionResults: questionResults.map(q => ({
        question: q.question,
        isCorrect: q.isCorrect,
        explanation: q.explanation,
        correctAnswer: q.correctAnswer,
        userAnswer: q.userAnswer
      }))
    };

    const newAchievements = await checkQuizAchievementsWithEmit(studentId, progress, quizHistory, io);
    
    if (newAchievements && newAchievements.length > 0 && io) {
      io.to(`user:${studentId}`).emit('achievements-unlocked', {
        achievements: newAchievements,
        message: `🏆 You've unlocked ${newAchievements.length} new achievement(s)!`,
        timestamp: new Date()
      });
    }

    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (learningPath && learningPath.currentPath && learningPath.currentPath.milestones) {
        for (let milestoneIndex = 0; milestoneIndex < learningPath.currentPath.milestones.length; milestoneIndex++) {
          const milestone = learningPath.currentPath.milestones[milestoneIndex];
          
          const quizInMilestone = milestone.quizzes?.find(q => 
            q.quizId?.toString() === quizId.toString()
          );
          
          if (quizInMilestone) {
            if (!quizInMilestone.attempts) quizInMilestone.attempts = [];
            quizInMilestone.attempts.push({
              date: new Date(),
              score,
              passed: score >= 70
            });
            
            if (score >= 70) {
              quizInMilestone.status = 'passed';
            }
            
            const allQuizzesPassed = milestone.quizzes?.every(q => q.status === 'passed') ?? true;
            const allTopicsCompleted = milestone.topics?.every(t => t.status === 'completed') ?? true;
            const allProjectsCompleted = milestone.projects?.every(p => p.status === 'completed') ?? true;
            
            if (allTopicsCompleted && allQuizzesPassed && allProjectsCompleted) {
              milestone.status = 'completed';
              milestone.completedAt = new Date();
              
              if (milestoneIndex + 1 < learningPath.currentPath.milestones.length) {
                const nextMilestone = learningPath.currentPath.milestones[milestoneIndex + 1];
                if (nextMilestone.status === 'locked') {
                  nextMilestone.status = 'available';
                  
                  if (io) {
                    io.to(`user:${studentId}`).emit('milestone-unlocked', {
                      milestone: nextMilestone.title,
                      message: `🔓 New milestone unlocked: ${nextMilestone.title}!`,
                      timestamp: new Date()
                    });
                  }
                }
              }
            }
            
            await learningPath.save();
            break;
          }
        }
      }
    } catch (pathError) {
      console.error('Error updating learning path from quiz:', pathError);
    }

    result.xpEarned = xpEarned;
    result.newLevel = progress?.stats?.level || 1;
    result.socketEventsSent = true;

    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      data: result
    });

  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const getQuizHistory = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const quizHistory = await QuizHistory.findOne({ studentId });
    
    if (!quizHistory || !quizHistory.attempts || quizHistory.attempts.length === 0) {
      return res.json({
        success: true,
        data: {
          quizzes: [],
          total: 0,
          page: parseInt(page),
          totalPages: 0
        }
      });
    }
    
    const sortedAttempts = [...quizHistory.attempts].sort((a, b) => 
      new Date(b.completedAt) - new Date(a.completedAt)
    );
    
    const total = sortedAttempts.length;
    const totalPages = Math.ceil(total / parseInt(limit));
    const paginatedAttempts = sortedAttempts.slice(skip, skip + parseInt(limit));
    
    const formattedQuizzes = paginatedAttempts.map(attempt => ({
      id: attempt.quizId,
      title: attempt.title,
      topic: attempt.topic,
      score: Math.round(attempt.score),
      totalQuestions: attempt.totalQuestions,
      correctAnswers: attempt.correctAnswers,
      completedAt: attempt.completedAt,
      difficulty: attempt.difficulty,
      timeSpent: attempt.timeSpent
    }));
    
    res.json({
      success: true,
      data: {
        quizzes: formattedQuizzes,
        total,
        page: parseInt(page),
        totalPages,
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('Get quiz history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quiz history',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const getQuizResultById = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { quizId } = req.params;
    
    const quizHistory = await QuizHistory.findOne({ studentId });
    
    if (!quizHistory) {
      return res.status(404).json({
        success: false,
        message: 'No quiz history found'
      });
    }
    
    const attempt = quizHistory.attempts.find(
      a => a.quizId && a.quizId.toString() === quizId
    );
    
    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Quiz result not found'
      });
    }
    
    let strengthsArray = [];
    if (attempt.strengths) {
      if (Array.isArray(attempt.strengths)) {
        strengthsArray = attempt.strengths.map(s => {
          if (typeof s === 'string') return s;
          if (s && typeof s === 'object') {
            if (s.category) return s.category;
            if (s.topic) return s.topic;
            if (s.name) return s.name;
          }
          return null;
        }).filter(s => s !== null);
      }
    }
    
    let weaknessesArray = [];
    if (attempt.weaknesses) {
      if (Array.isArray(attempt.weaknesses)) {
        weaknessesArray = attempt.weaknesses.map(w => {
          if (typeof w === 'string') return w;
          if (w && typeof w === 'object') {
            if (w.category) return w.category;
            if (w.topic) return w.topic;
            if (w.name) return w.name;
          }
          return null;
        }).filter(w => w !== null);
      }
    }
    
    strengthsArray = [...new Set(strengthsArray.filter(s => s && s !== 'undefined'))];
    weaknessesArray = [...new Set(weaknessesArray.filter(w => w && w !== 'undefined'))];
    
    const progress = await StudentProgress.findOne({ studentId });
    const currentLevel = progress?.stats?.level || 1;
    const xpEarned = attempt.xpEarned || Math.round(attempt.score * 1.5);
    
    res.json({
      success: true,
      data: {
        id: attempt.quizId,
        title: attempt.title,
        topic: attempt.topic,
        score: Math.round(attempt.score),
        totalQuestions: attempt.totalQuestions,
        correctAnswers: attempt.correctAnswers,
        incorrectAnswers: attempt.incorrectAnswers,
        timeSpent: attempt.timeSpent,
        completedAt: attempt.completedAt,
        difficulty: attempt.difficulty,
        questions: attempt.questions || [],
        strengths: strengthsArray,
        weaknesses: weaknessesArray,
        mentalStateAtTime: attempt.mentalStateAtTime,
        xpEarned: xpEarned,
        newLevel: currentLevel,
        oldLevel: currentLevel - 1,
        feedback: {
          message: getScoreFeedback(attempt.score).message,
          tip: getScoreFeedback(attempt.score).tip,
          emoji: getScoreFeedback(attempt.score).emoji
        },
        passed: attempt.score >= 70
      }
    });
    
  } catch (error) {
    console.error('Get quiz result error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quiz result',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const deleteQuizHistory = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { quizId } = req.params;
    
    const quizHistory = await QuizHistory.findOne({ studentId });
    
    if (!quizHistory) {
      return res.status(404).json({
        success: false,
        message: 'No quiz history found'
      });
    }
    
    const initialLength = quizHistory.attempts.length;
    quizHistory.attempts = quizHistory.attempts.filter(
      a => a.quizId && a.quizId.toString() !== quizId
    );
    
    if (quizHistory.attempts.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Quiz attempt not found'
      });
    }
    
    if (quizHistory.attempts.length > 0) {
      const totalQuizzes = quizHistory.attempts.length;
      const totalScore = quizHistory.attempts.reduce((sum, a) => sum + a.score, 0);
      const bestScore = Math.max(...quizHistory.attempts.map(a => a.score));
      const worstScore = Math.min(...quizHistory.attempts.map(a => a.score));
      const totalTimeSpent = quizHistory.attempts.reduce((sum, a) => sum + (a.timeSpent || 0), 0);
      
      quizHistory.statistics = {
        totalQuizzes,
        averageScore: totalScore / totalQuizzes,
        bestScore,
        worstScore,
        totalTimeSpent,
        weakTopics: quizHistory.statistics?.weakTopics || [],
        topicsMastered: quizHistory.statistics?.topicsMastered || []
      };
    } else {
      quizHistory.statistics = {
        totalQuizzes: 0,
        averageScore: 0,
        bestScore: 0,
        worstScore: 100,
        totalTimeSpent: 0,
        weakTopics: [],
        topicsMastered: []
      };
    }
    
    await quizHistory.save();
    
    const io = req.app.locals.io;
    if (io) {
      await triggerProgressUpdate(io, studentId, 'quiz_deleted', {
        deletedQuizId: quizId
      });
    }
    
    res.json({
      success: true,
      message: 'Quiz history entry deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete quiz history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting quiz history',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const getQuizResults = async (req, res) => {
  try {
    const studentId = req.user.id;
    const quizId = req.params.id;

    const quizHistory = await QuizHistory.findOne({ studentId });
    
    if (!quizHistory) {
      return res.json({
        success: true,
        data: { attempts: [] }
      });
    }

    const attempts = quizHistory.attempts.filter(
      attempt => attempt.quizId && attempt.quizId.toString() === quizId
    ).map(attempt => ({
      id: attempt._id,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      correctAnswers: attempt.correctAnswers,
      timeSpent: attempt.timeSpent,
      completedAt: attempt.completedAt,
      passed: attempt.score >= 70,
      strengths: attempt.strengths || [],
      weaknesses: attempt.weaknesses || []
    }));

    const improvement = attempts.length >= 2
      ? attempts[attempts.length - 1].score - attempts[0].score
      : 0;

    res.json({
      success: true,
      data: {
        attempts,
        totalAttempts: attempts.length,
        bestScore: attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : 0,
        averageScore: attempts.length > 0
          ? attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length
          : 0,
        improvement,
        lastAttempt: attempts[attempts.length - 1] || null
      }
    });

  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quiz results',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const getQuizStats = async (req, res) => {
  try {
    const studentId = req.user.id;

    const quizHistory = await QuizHistory.findOne({ studentId });

    if (!quizHistory || !quizHistory.attempts || quizHistory.attempts.length === 0) {
      return res.json({
        success: true,
        data: {
          overview: {
            totalQuizzes: 0,
            averageScore: 0,
            bestScore: 0,
            worstScore: 0,
            totalTimeSpent: 0
          },
          topicsMastered: [],
          weakTopics: []
        }
      });
    }

    const stats = quizHistory.statistics || {
      totalQuizzes: 0,
      averageScore: 0,
      bestScore: 0,
      worstScore: 0,
      totalTimeSpent: 0,
      weakTopics: [],
      topicsMastered: []
    };

    res.json({
      success: true,
      data: {
        overview: {
          totalQuizzes: stats.totalQuizzes || 0,
          averageScore: parseFloat((stats.averageScore || 0).toFixed(1)),
          bestScore: stats.bestScore || 0,
          worstScore: stats.worstScore || 0,
          totalTimeSpent: stats.totalTimeSpent || 0
        },
        topicsMastered: stats.topicsMastered || [],
        weakTopics: stats.weakTopics || []
      }
    });

  } catch (error) {
    console.error('Get quiz stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching quiz statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

export const generateQuiz = async (req, res) => {
  try {
    const { topic, difficulty, numQuestions = 10 } = req.body;
    const studentId = req.user.id;

    if (!topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }

    let mentalState = null;
    try {
      mentalState = await MentalState.findOne({ studentId });
    } catch (mentalError) {
      console.error('Error fetching mental state:', mentalError);
    }

    let adjustedDifficulty = difficulty || 'intermediate';
    let adjustedQuestions = Math.min(Math.max(numQuestions, 5), 20);

    if (mentalState && mentalState.currentState) {
      if (mentalState.currentState.stressLevel === 'high') {
        adjustedDifficulty = 'beginner';
        adjustedQuestions = Math.min(adjustedQuestions, 5);
      } else if (mentalState.currentState.motivationLevel === 'high') {
        adjustedDifficulty = 'advanced';
        adjustedQuestions = Math.min(adjustedQuestions, 15);
      }
    }

    let generatedQuiz;
    try {
      generatedQuiz = await aiService.generateQuiz({
        topic,
        difficulty: adjustedDifficulty,
        numQuestions: adjustedQuestions
      });
    } catch (aiError) {
      console.error('AI service error:', aiError);
      return res.status(500).json({
        success: false,
        message: 'AI service unavailable. Please try again later.',
        error: aiError.message
      });
    }

    if (!generatedQuiz) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate quiz content'
      });
    }

    let questions = [];
    
    if (generatedQuiz.questions && Array.isArray(generatedQuiz.questions)) {
      questions = generatedQuiz.questions;
    } else if (Array.isArray(generatedQuiz)) {
      questions = generatedQuiz;
    } else {
      return res.status(500).json({
        success: false,
        message: 'Invalid quiz structure from AI service'
      });
    }

    if (questions.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No questions generated. Please try again.'
      });
    }

    const formattedQuestions = questions.map((q, index) => ({
      question: q.question || `Question ${index + 1} about ${topic}`,
      options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswer: q.correctAnswer || q.correct_answer || 'Option A',
      explanation: q.explanation || 'No explanation available',
      points: q.points || 1,
      difficulty: q.difficulty || adjustedDifficulty,
      category: q.category || topic
    }));

    const newQuiz = new Quiz({
      title: `${topic} Quiz`,
      topic: topic,
      difficulty: adjustedDifficulty,
      questions: formattedQuestions,
      timeLimit: adjustedQuestions * 2,
      isAIGenerated: true,
      createdBy: studentId,
      isPublished: true,
      quizType: 'personal',
      classId: null,
      isActive: true,
      maxAttempts: 3
    });

    const validationError = newQuiz.validateSync();
    if (validationError) {
      console.error('Validation error:', validationError);
      return res.status(400).json({
        success: false,
        message: 'Quiz validation failed',
        errors: Object.keys(validationError.errors).map(key => validationError.errors[key].message)
      });
    }

    await newQuiz.save();

    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'quiz_generated',
            title: 'AI Quiz Generated',
            description: `Created a ${adjustedQuestions}-question quiz on ${topic}`,
            metadata: {
              topic,
              quizId: newQuiz._id,
              difficulty: adjustedDifficulty,
              numQuestions: adjustedQuestions
            },
            icon: '❓',
            color: '#8b5cf6',
            importance: 'low',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    const sanitizedQuiz = {
      quizId: newQuiz._id,
      _id: newQuiz._id,
      title: newQuiz.title,
      topic: newQuiz.topic,
      difficulty: newQuiz.difficulty,
      timeLimit: newQuiz.timeLimit,
      questions: newQuiz.questions.map(q => ({
        question: q.question,
        options: q.options,
        explanation: q.explanation,
        points: q.points,
        difficulty: q.difficulty
      })),
      metadata: {
        adaptedFor: mentalState?.currentState?.motivationLevel === 'high' ? 'challenge' : 
                   mentalState?.currentState?.stressLevel === 'high' ? 'comfort' : 'balanced'
      }
    };

    res.json({
      success: true,
      message: 'Quiz generated successfully',
      data: sanitizedQuiz
    });

  } catch (error) {
    console.error('Generate quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ============= SOCKET-ENHANCED HELPER FUNCTIONS =============

const checkQuizAchievementsWithEmit = async (studentId, progress, quizHistory, io) => {
  if (!progress || !quizHistory) return [];
  
  const achievements = [];
  const stats = quizHistory.statistics || { totalQuizzes: 0 };
  const newAchievements = [];

  if (stats.totalQuizzes === 1) {
    achievements.push({
      achievementId: 'first_quiz',
      name: 'First Quiz',
      description: 'Completed your first quiz',
      icon: '🏆',
      xpReward: 50
    });
  }

  if (stats.totalQuizzes >= 5 && stats.totalQuizzes < 6) {
    achievements.push({
      achievementId: 'quiz_enthusiast',
      name: 'Quiz Enthusiast',
      description: 'Completed 5 quizzes',
      icon: '📚',
      xpReward: 100
    });
  }

  if (stats.totalQuizzes >= 10 && stats.totalQuizzes < 11) {
    achievements.push({
      achievementId: 'quiz_master',
      name: 'Quiz Master',
      description: 'Completed 10 quizzes',
      icon: '🏅',
      xpReward: 200
    });
  }

  if (stats.totalQuizzes >= 25 && stats.totalQuizzes < 26) {
    achievements.push({
      achievementId: 'quiz_legend',
      name: 'Quiz Legend',
      description: 'Completed 25 quizzes',
      icon: '👑',
      xpReward: 500
    });
  }

  const lastAttempt = quizHistory.attempts?.[quizHistory.attempts.length - 1];
  if (lastAttempt && lastAttempt.score === 100) {
    const hasPerfectScore = progress.achievements?.some(a => a.achievementId === 'perfect_score');
    if (!hasPerfectScore) {
      achievements.push({
        achievementId: 'perfect_score',
        name: 'Perfect Score',
        description: 'Got 100% on a quiz',
        icon: '🌟',
        xpReward: 100
      });
    }
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
        progress.stats.xpPoints = (progress.stats.xpPoints || 0) + achievement.xpReward;
        newAchievements.push(achievement);
        
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
};

export const getQuizStatsSnapshot = async (studentId) => {
  try {
    const quizHistory = await QuizHistory.findOne({ studentId });
    
    if (!quizHistory) {
      return {
        totalQuizzes: 0,
        averageScore: 0,
        bestScore: 0,
        weakTopics: [],
        topicsMastered: []
      };
    }
    
    return {
      totalQuizzes: quizHistory.statistics?.totalQuizzes || 0,
      averageScore: quizHistory.statistics?.averageScore || 0,
      bestScore: quizHistory.statistics?.bestScore || 0,
      weakTopics: quizHistory.statistics?.weakTopics || [],
      topicsMastered: quizHistory.statistics?.topicsMastered || []
    };
  } catch (error) {
    console.error('Error getting quiz stats snapshot:', error);
    return null;
  }
};

// ==================== TEACHER QUIZ CONTROLLERS ====================

export const getTeacherQuizzes = async (req, res) => {
  try {
    const teacherId = req.userId;
    const quizzes = await Quiz.find({ createdBy: teacherId, quizType: 'class' }).populate('classId', 'className');
    return res.status(200).json({
      success: true,
      quizzes: quizzes.map(q => ({
        id: q._id,
        title: q.title,
        description: q.description,
        classId: q.classId?._id,
        className: q.classId?.className,
        questionCount: q.questions.length,
        submissions: q.submissions?.length || 0,
        averageScore: q.submissions?.length
          ? Math.round(q.submissions.reduce((sum, s) => sum + s.percentage, 0) / q.submissions.length)
          : 0,
        dueDate: q.dueDate,
        status: q.isActive ? 'active' : 'inactive'
      }))
    });
  } catch (error) {
    console.error('Get teacher quizzes error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createQuiz = async (req, res) => {
  try {
    const { title, description, classId, timeLimit, attemptsAllowed, dueDate, questions, topic } = req.body;
    const teacherId = req.userId;
    const io = req.app.locals.io;

    if (!title || !classId || !questions || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const Class = mongoose.model('Class');
    const classData = await Class.findById(classId);
    
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    const classTeacherId = classData.teacherId?.toString();
    const currentTeacherId = teacherId?.toString();
    
    if (!classTeacherId) {
      classData.teacherId = teacherId;
      await classData.save();
    } else if (classTeacherId !== currentTeacherId) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not own this class. Only the class creator can add quizzes.' 
      });
    }

    const quizTopic = topic || classData.subject || title;

    // Format questions
    const formattedQuestions = questions.map(q => {
      let correctAnswerText = '';
      
      if (typeof q.correctAnswer === 'string' && q.options.includes(q.correctAnswer)) {
        correctAnswerText = q.correctAnswer;
      } else if (typeof q.correctAnswer === 'number' && q.options[q.correctAnswer]) {
        correctAnswerText = q.options[q.correctAnswer];
      } else if (typeof q.correctAnswer === 'string' && !isNaN(parseInt(q.correctAnswer)) && q.options[parseInt(q.correctAnswer)]) {
        correctAnswerText = q.options[parseInt(q.correctAnswer)];
      } else if (typeof q.correctAnswer === 'string' && q.correctAnswer.length === 1) {
        const letterMap = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
        const index = letterMap[q.correctAnswer];
        if (index !== undefined && q.options[index]) {
          correctAnswerText = q.options[index];
        }
      } else {
        correctAnswerText = q.options[0] || 'Option A';
        console.warn(`⚠️ Could not determine correct answer for question, defaulting to: ${correctAnswerText}`);
      }
      
      return {
        question: q.text,
        options: q.options,
        correctAnswer: correctAnswerText,
        explanation: q.explanation || '',
        points: q.points || 1,
        difficulty: q.difficulty || 'intermediate',
        category: quizTopic
      };
    });

    const newQuiz = await Quiz.create({
      createdBy: teacherId,
      classId: new mongoose.Types.ObjectId(classId),
      title,
      description,
      topic: quizTopic,
      questions: formattedQuestions,
      timeLimit: timeLimit || 30,
      maxAttempts: attemptsAllowed || 1,
      dueDate: dueDate ? new Date(dueDate) : null,
      isActive: true,
      isPublished: true,
      quizType: 'class',
      submissions: []
    });

    // ============ ENHANCED NOTIFICATION FOR STUDENTS ============
    if (io && classData.students && classData.students.length > 0) {
      const notificationService = new NotificationService(io);
      const User = mongoose.model('User');
      const teacher = await User.findById(teacherId).select('name username');
      const teacherName = teacher?.name || teacher?.username || 'Teacher';
      
      const studentIds = classData.students.map(s => s.studentId);
      const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString() : null;
      
      // Socket emit for real-time
      studentIds.forEach(studentId => {
        io.to(`user:${studentId}`).emit('new-quiz-assigned', {
          quizId: newQuiz._id,
          quizTitle: newQuiz.title,
          className: classData.className,
          dueDate: newQuiz.dueDate,
          questionCount: newQuiz.questions.length,
          timestamp: new Date()
        });
      });
      
      // Enhanced notification via NotificationService
      await notificationService.sendToMultipleUsers(studentIds, {
        type: 'quiz_assigned',
        title: '📝 New Quiz Assigned!',
        message: `${teacherName} assigned "${title}" to ${classData.className}${dueDateStr ? ` (Due: ${dueDateStr})` : ''}`,
        link: `/student/classes/${classId}`,
        icon: '📝',
        color: '#10b981',
        priority: 'high',
        data: {
          quizId: newQuiz._id,
          quizTitle: title,
          classId: classId,
          className: classData.className,
          dueDate: dueDate,
          questionCount: newQuiz.questions.length,
          teacherName: teacherName
        }
      });
    } else if (!classData.students || classData.students.length === 0) {
      console.log(`⚠️ No students in class ${classId}, skipping notifications`);
    }

    return res.status(201).json({ 
      success: true, 
      message: 'Quiz created successfully', 
      quiz: newQuiz 
    });
    
  } catch (error) {
    console.error('Create quiz error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, timeLimit, attemptsAllowed, dueDate, questions, topic } = req.body;
    const teacherId = req.userId;
    const io = req.app.locals.io;

    const quiz = await Quiz.findOne({ _id: id, createdBy: teacherId });
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found or not owned by you' });
    }

    const oldDueDate = quiz.dueDate;
    
    if (title) quiz.title = title;
    if (description) quiz.description = description;
    if (timeLimit) quiz.timeLimit = timeLimit;
    if (attemptsAllowed) quiz.maxAttempts = attemptsAllowed;
    if (dueDate) quiz.dueDate = new Date(dueDate);
    if (topic) quiz.topic = topic;

    if (questions && Array.isArray(questions)) {
      quiz.questions = questions.map(q => ({
        question: q.text || q.question,
        options: q.options,
        correctAnswer: q.correctAnswerText || (q.options && q.options[q.correctAnswer]) || 'Option A',
        explanation: q.explanation || '',
        points: q.points || 1,
        difficulty: 'intermediate',
        category: quiz.topic
      }));
    }

    await quiz.save();

    // Notify students about quiz update if due date changed
    if (io && quiz.classId && dueDate && oldDueDate?.toString() !== dueDate) {
      const Class = mongoose.model('Class');
      const classData = await Class.findById(quiz.classId);
      
      if (classData && classData.students) {
        const notificationService = new NotificationService(io);
        const studentIds = classData.students.map(s => s.studentId);
        
        await notificationService.sendToMultipleUsers(studentIds, {
          type: 'quiz_assigned',
          title: '📝 Quiz Updated!',
          message: `"${quiz.title}" due date has been updated to ${new Date(dueDate).toLocaleDateString()}`,
          link: `/student/classes/${quiz.classId}`,
          icon: '📝',
          color: '#f59e0b',
          priority: 'medium',
          data: {
            quizId: quiz._id,
            quizTitle: quiz.title,
            classId: quiz.classId,
            dueDate: dueDate
          }
        });
      }
    }

    res.json({ success: true, message: 'Quiz updated', quiz });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const copyQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.userId;

    const original = await Quiz.findOne({ _id: id, createdBy: teacherId });
    if (!original) {
      return res.status(404).json({ success: false, message: 'Quiz not found or not owned by you' });
    }

    const newQuiz = new Quiz({
      ...original.toObject(),
      _id: undefined,
      title: `${original.title} (Copy)`,
      createdBy: teacherId,
      isPublished: true,
      isActive: true,
      submissions: [],
      createdAt: undefined,
      updatedAt: undefined
    });

    await newQuiz.save();

    res.status(201).json({ success: true, message: 'Quiz copied', quiz: newQuiz });
  } catch (error) {
    console.error('Copy quiz error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.userId;

    // Get quiz info before deleting for notification
    const quiz = await Quiz.findOne({ _id: id, createdBy: teacherId });
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found or not owned by you' });
    }

    const result = await Quiz.findOneAndDelete({ _id: id, createdBy: teacherId });
    
    // Notify students about quiz deletion
    if (quiz.classId) {
      const io = req.app.locals.io;
      if (io) {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(quiz.classId);
        
        if (classData && classData.students) {
          const notificationService = new NotificationService(io);
          const studentIds = classData.students.map(s => s.studentId);
          
          await notificationService.sendToMultipleUsers(studentIds, {
            type: 'system',
            title: '❌ Quiz Cancelled',
            message: `"${quiz.title}" has been cancelled by the teacher`,
            link: `/student/classes/${quiz.classId}`,
            icon: '❌',
            color: '#ef4444',
            priority: 'medium',
            data: {
              quizId: quiz._id,
              quizTitle: quiz.title,
              classId: quiz.classId
            }
          });
        }
      }
    }

    res.json({ success: true, message: 'Quiz deleted' });
  } catch (error) {
    console.error('Delete quiz error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getTeacherQuizResults = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.userId;

    const quiz = await Quiz.findOne({ _id: id, createdBy: teacherId });
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found or not owned by you' });
    }

    const submissions = quiz.submissions || [];
    
    const User = mongoose.model('User');
    const results = await Promise.all(submissions.map(async (sub) => {
      let studentName = 'Unknown';
      let studentEmail = '';
      let isDeleted = false;
      
      try {
        const student = await User.findById(sub.studentId).select('name username email');
        
        if (student) {
          // Student exists
          studentName = student.name || student.username || 'Unknown';
          studentEmail = student.email || '';
          isDeleted = false;
        } else {
          // Student was deleted
          isDeleted = true;
          studentName = 'Student (Deleted)';
          console.warn(`⚠️ Deleted student submission found: ${sub.studentId}`);
        }
      } catch (userError) {
        console.error(`Error fetching student ${sub.studentId}:`, userError);
        isDeleted = true;
        studentName = 'Error loading user';
      }
      
      return {
        studentId: sub.studentId,
        studentName: studentName,
        studentEmail: studentEmail,
        score: sub.score,
        percentage: sub.percentage,
        submittedAt: sub.submittedAt,
        isDeleted: isDeleted  // ✅ Add this flag
      };
    }));

    // Optional: Filter out deleted students if you don't want to show them
    // const filteredResults = results.filter(r => !r.isDeleted);
    
    res.json({ 
      success: true, 
      results: results,  // Or use filteredResults
      totalSubmissions: submissions.length,
      deletedSubmissions: results.filter(r => r.isDeleted).length
    });
  } catch (error) {
    console.error('Get teacher quiz results error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getStudentClassQuizzes = async (req, res) => {
  try {
    const { classId } = req.params;
    const studentId = req.userId || req.user?.id;

    const Class = mongoose.model('Class');
    const classData = await Class.findById(classId);
    
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    let isEnrolled = false;
    
    if (classData.students && Array.isArray(classData.students)) {
      isEnrolled = classData.students.some(student => {
        const studentIdInClass = student.studentId?.toString();
        return studentIdInClass === studentId.toString();
      });
    }
    
    if (!isEnrolled) {
      const Enrollment = mongoose.model('Enrollment');
      const enrollmentCheck = await Enrollment.findOne({ 
        studentId: studentId,
        classId: classId,
        status: 'active' 
      });
      
      if (enrollmentCheck) {
        isEnrolled = true;
      }
    }
    
    if (!isEnrolled) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not enrolled in this class' 
      });
    }

    const quizzes = await Quiz.find({ 
      classId: classId,
      isActive: true,
      isPublished: true
    })
    .select('-questions.correctAnswer')
    .sort({ dueDate: 1, createdAt: -1 });

    const QuizHistoryModel = mongoose.model('QuizHistory');
    const quizHistory = await QuizHistoryModel.findOne({ studentId });

    const formattedQuizzes = quizzes.map(quiz => {
      const hasTaken = quizHistory?.attempts?.some(
        attempt => attempt.quizId?.toString() === quiz._id.toString()
      );

      let status = 'available';
      if (hasTaken) status = 'completed';
      else if (quiz.dueDate && new Date(quiz.dueDate) < new Date()) status = 'overdue';

      return {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        topic: quiz.topic,
        questionCount: quiz.questions.length,
        timeLimit: quiz.timeLimit,
        dueDate: quiz.dueDate,
        attemptsAllowed: quiz.maxAttempts || 1,
        status,
        createdAt: quiz.createdAt
      };
    });

    res.json({
      success: true,
      data: formattedQuizzes
    });

  } catch (error) {
    console.error('Get student class quizzes error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching quizzes' 
    });
  }
};

export const getStudentQuizById = async (req, res) => {
  try {
    const { quizId } = req.params;
    const studentId = req.userId || req.user?.id;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found' });
    }

    const isCreator = quiz.createdBy?.toString() === studentId;
    
    if (quiz.quizType === 'personal' || isCreator) {
      if (quiz.classId && isCreator) {
        quiz.classId = null;
        quiz.quizType = 'personal';
        await quiz.save();
      }
    } else if (quiz.classId) {
      let isEnrolled = false;
      
      const enrollmentCheck = await Enrollment.findOne({ 
        studentId, 
        classId: quiz.classId,
        status: 'active' 
      });
      
      if (enrollmentCheck) {
        isEnrolled = true;
      }
      
      if (!isEnrolled) {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(quiz.classId);
        if (classData) {
          isEnrolled = classData.students?.some(
            student => student.studentId?.toString() === studentId
          );
        }
      }
      
      if (!isEnrolled) {
        return res.status(403).json({ 
          success: false, 
          message: 'You are not enrolled in the class for this quiz' 
        });
      }
    }

    const sanitizedQuiz = {
      id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      topic: quiz.topic,
      timeLimit: quiz.timeLimit,
      quizType: quiz.quizType || 'class',
      questions: quiz.questions.map((q, idx) => ({
        id: q._id || idx,
        text: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        points: q.points || 1
      }))
    };

    res.json({ success: true, data: sanitizedQuiz });
  } catch (error) {
    console.error('Get student quiz error:', error);
    res.status(500).json({ success: false, message: 'Error fetching quiz' });
  }
};

export const getPersonalQuizzes = async (req, res) => {
  try {
    const studentId = req.userId || req.user?.id;

    const quizzes = await Quiz.find({ 
      createdBy: studentId,
      quizType: 'personal',
      isPublished: true
    })
    .select('-questions.correctAnswer')
    .sort({ createdAt: -1 });

    const formattedQuizzes = quizzes.map(quiz => ({
      id: quiz._id,
      title: quiz.title,
      topic: quiz.topic,
      questionCount: quiz.questions.length,
      timeLimit: quiz.timeLimit,
      createdAt: quiz.createdAt,
      attemptsAllowed: quiz.maxAttempts || 1
    }));

    res.json({ success: true, data: formattedQuizzes });
  } catch (error) {
    console.error('Get personal quizzes error:', error);
    res.status(500).json({ success: false, message: 'Error fetching personal quizzes' });
  }
};