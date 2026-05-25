import AINotes from '../models/AINotes.js';
import Activity from '../models/Activity.js';
import MentalState from '../models/MentalState.js';
import StudentProgress from '../models/StudentProgress.js';
import Quiz from '../models/Quiz.js';
import QuizHistory from '../models/QuizHistory.js';
import LearningPathModel from '../models/LearningPath.js';
import RecommendedTopics from '../models/RecommendedTopics.js';
import aiService from '../services/aiService.js';
import constants from '../config/constants.js';
import learningPathService from '../services/learningPathService.js';

// @desc    Generate AI notes
// @route   POST /api/ai/generate-notes
// @access  Private (Student)
export const generateAINotes = async (req, res) => {
  try {
    const { topic, difficulty, includeExamples, includeQuestions, customInstructions } = req.body;
    const studentId = req.user.id;

    if (!topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required'
      });
    }

    const mentalState = await MentalState.findOne({ studentId });

    let aiNotes = await AINotes.findOne({ studentId });
    
    if (!aiNotes) {
      aiNotes = new AINotes({ studentId, notes: [] });
    }

    const recentSimilar = aiNotes.notes
      .filter(n => n.topic.toLowerCase() === topic.toLowerCase())
      .sort((a, b) => b.metadata.generatedAt - a.metadata.generatedAt)[0];

    if (recentSimilar && (Date.now() - recentSimilar.metadata.generatedAt) < 3600000) {
      return res.status(400).json({
        success: false,
        message: 'You already generated notes for this topic recently.',
        existingNote: {
          id: recentSimilar._id,
          title: recentSimilar.title,
          generatedAt: recentSimilar.metadata.generatedAt
        }
      });
    }

    const generatedNotes = await aiService.generateNotes({
      topic,
      difficulty: difficulty || 'intermediate',
      includeExamples: includeExamples !== false,
      includeQuestions: includeQuestions !== false,
      mentalState: mentalState?.currentState,
      customInstructions
    });

    // Formatting Logic (Kept identical to your original logic)
    let formattedKeyPoints = [];
    if (generatedNotes.keyPoints) {
      if (Array.isArray(generatedNotes.keyPoints)) {
        formattedKeyPoints = generatedNotes.keyPoints.map(point => 
          typeof point === 'string' ? { point, explanation: '', importance: 'medium' } : point
        );
      } else if (typeof generatedNotes.keyPoints === 'string') {
        formattedKeyPoints = [{ point: generatedNotes.keyPoints, explanation: '', importance: 'medium' }];
      }
    }

    let formattedDetailedExplanation = {};
    if (generatedNotes.detailedExplanation) {
      formattedDetailedExplanation = typeof generatedNotes.detailedExplanation === 'string' 
        ? { sections: [{ title: 'Detailed Explanation', content: generatedNotes.detailedExplanation, examples: [] }] }
        : generatedNotes.detailedExplanation;
    }

    const formattedContent = {
      overview: generatedNotes.overview || '',
      keyPoints: formattedKeyPoints,
      detailedExplanation: formattedDetailedExplanation,
      codeExamples: (generatedNotes.codeExamples || []).map(ex => ({
        title: ex.title || 'Code Example',
        language: ex.language || 'javascript',
        code: ex.code || '',
        explanation: ex.explanation || '',
        output: ex.output || '',
        tryItYourself: ex.tryItYourself || ''
      })),
      practiceQuestions: (generatedNotes.practiceQuestions || []).map(q => ({
        question: q.question || '',
        answer: q.answer || '',
        hint: q.hint || '',
        difficulty: q.difficulty || 'beginner',
        type: q.type || 'theoretical'
      })),
      summary: generatedNotes.summary || ''
    };

    const estimatedReadTime = Math.ceil(
      (formattedContent.overview?.length || 0) / 1000 + 
      (JSON.stringify(formattedContent.detailedExplanation)?.length || 0) / 1500
    );

    const newNote = {
      topic,
      title: `${topic} - Study Notes`,
      content: formattedContent,
      metadata: {
        difficulty: difficulty || 'intermediate',
        estimatedReadTime: Math.max(5, estimatedReadTime),
        generatedAt: new Date(),
        lastAccessed: new Date(),
        accessCount: 1,
        tags: [topic, difficulty, 'ai-generated'].filter(Boolean),
        language: 'en',
        version: 1
      },
      aiMetadata: {
        model: constants.AI?.MODEL || 'gpt-4',
        tokensUsed: generatedNotes.tokensUsed || 0,
        processingTime: generatedNotes.processingTime || 0
      },
      isArchived: false
    };

    aiNotes.notes.push(newNote);
    await aiNotes.save();

    const savedNote = aiNotes.notes[aiNotes.notes.length - 1];
    const noteId = savedNote._id;

    aiNotes.statistics.totalNotes += 1;
    if (!aiNotes.statistics.totalTopics.includes(topic)) {
      aiNotes.statistics.totalTopics.push(topic);
    }

    const favoriteIndex = aiNotes.statistics.favoriteTopics.findIndex(f => f.topic === topic);
    if (favoriteIndex >= 0) {
      aiNotes.statistics.favoriteTopics[favoriteIndex].count += 1;
    } else {
      aiNotes.statistics.favoriteTopics.push({ topic, count: 1 });
    }
    await aiNotes.save();

    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'notes_generated',
            title: 'AI Notes Generated',
            description: `Created study notes for ${topic}`,
            metadata: { topic, noteId, noteTitle: savedNote.title, difficulty, estimatedReadTime },
            icon: '📝',
            color: '#10b981',
            importance: 'medium',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    await StudentProgress.findOneAndUpdate(
      { studentId },
      { $inc: { 'stats.xpPoints': 10 } }
    );

    res.status(201).json({
      success: true,
      data: {
        id: noteId,
        topic: savedNote.topic,
        title: savedNote.title,
        content: savedNote.content,
        metadata: savedNote.metadata,
        downloadUrls: {
          pdf: `/api/ai/download/${noteId}/pdf`,
          txt: `/api/ai/download/${noteId}/txt`,
          json: `/api/ai/download/${noteId}/json`,
          markdown: `/api/ai/download/${noteId}/markdown`
        },
        stats: {
          readTime: estimatedReadTime,
          sections: Object.keys(savedNote.content).length,
          hasExamples: (savedNote.content.codeExamples?.length || 0) > 0,
          hasQuestions: (savedNote.content.practiceQuestions?.length || 0) > 0
        }
      }
    });
  } catch (error) {
    console.error('AI notes generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate notes' });
  }
};

// backend/controllers/aiController.js
// Add these functions after your existing code

// @desc    Get notes history with pagination
// @route   GET /api/ai/notes/history
// @access  Private (Student)
export const getNotesHistory = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const aiNotes = await AINotes.findOne({ studentId });

    if (!aiNotes || !aiNotes.notes || aiNotes.notes.length === 0) {
      return res.json({
        success: true,
        data: {
          notes: [],
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0
        }
      });
    }

    // Sort notes by generated date (newest first)
    const sortedNotes = [...aiNotes.notes].sort(
      (a, b) => new Date(b.metadata.generatedAt) - new Date(a.metadata.generatedAt)
    );

    const total = sortedNotes.length;
    const totalPages = Math.ceil(total / limitNum);
    
    const paginatedNotes = sortedNotes.slice(skip, skip + limitNum);

    const formattedNotes = paginatedNotes.map(note => ({
      id: note._id,
      topic: note.topic,
      title: note.title,
      content: {
        overview: note.content.overview,
        keyPoints: note.content.keyPoints?.slice(0, 3) // Preview only
      },
      metadata: {
        difficulty: note.metadata.difficulty,
        estimatedReadTime: note.metadata.estimatedReadTime,
        generatedAt: note.metadata.generatedAt,
        tags: note.metadata.tags
      },
      stats: {
        hasExamples: (note.content.codeExamples?.length || 0) > 0,
        hasQuestions: (note.content.practiceQuestions?.length || 0) > 0
      }
    }));

    res.json({
      success: true,
      data: {
        notes: formattedNotes,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages
      }
    });

  } catch (error) {
    console.error('Get notes history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notes history',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Get single note by ID
// @route   GET /api/ai/notes/:noteId
// @access  Private (Student)
export const getNoteById = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { noteId } = req.params;

    const aiNotes = await AINotes.findOne({ studentId });

    if (!aiNotes) {
      return res.status(404).json({
        success: false,
        message: 'No notes found'
      });
    }

    const note = aiNotes.notes.id(noteId);
    
    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    // Update access count
    note.metadata.lastAccessed = new Date();
    note.metadata.accessCount = (note.metadata.accessCount || 0) + 1;
    await aiNotes.save();

    res.json({
      success: true,
      data: {
        id: note._id,
        topic: note.topic,
        title: note.title,
        content: note.content,
        metadata: note.metadata,
        aiMetadata: note.aiMetadata,
        downloadUrls: {
          txt: `/api/ai/download/${noteId}/txt`,
          json: `/api/ai/download/${noteId}/json`,
          markdown: `/api/ai/download/${noteId}/markdown`
        },
        stats: {
          readTime: note.metadata.estimatedReadTime,
          sections: Object.keys(note.content).length,
          hasExamples: (note.content.codeExamples?.length || 0) > 0,
          hasQuestions: (note.content.practiceQuestions?.length || 0) > 0,
          accessCount: note.metadata.accessCount
        }
      }
    });

  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching note',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Delete a note
// @route   DELETE /api/ai/notes/:noteId
// @access  Private (Student)
export const deleteNote = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { noteId } = req.params;

    const aiNotes = await AINotes.findOne({ studentId });

    if (!aiNotes) {
      return res.status(404).json({
        success: false,
        message: 'No notes found'
      });
    }

    // Find the note
    const note = aiNotes.notes.id(noteId);
    
    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    // Remove the note
    const noteIndex = aiNotes.notes.findIndex(n => n._id.toString() === noteId);
    if (noteIndex !== -1) {
      aiNotes.notes.splice(noteIndex, 1);
      
      // Update statistics
      aiNotes.statistics.totalNotes = aiNotes.notes.length;
      
      // Update favorite topics
      const topicIndex = aiNotes.statistics.favoriteTopics.findIndex(f => f.topic === note.topic);
      if (topicIndex !== -1) {
        if (aiNotes.statistics.favoriteTopics[topicIndex].count > 1) {
          aiNotes.statistics.favoriteTopics[topicIndex].count -= 1;
        } else {
          aiNotes.statistics.favoriteTopics.splice(topicIndex, 1);
        }
      }
      
      // Update total topics list
      const remainingTopics = aiNotes.notes.map(n => n.topic);
      aiNotes.statistics.totalTopics = [...new Set(remainingTopics)];
      
      await aiNotes.save();
    }

    // Add activity for deletion
    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'notes_generated',
            title: 'Note Deleted',
            description: `Deleted study notes for ${note.topic}`,
            metadata: { topic: note.topic, noteId },
            icon: '🗑️',
            color: '#ef4444',
            importance: 'low',
            timestamp: new Date()
          }
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });

  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting note',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Archive note (soft delete)
// @route   PUT /api/ai/notes/:noteId/archive
// @access  Private (Student)
export const archiveNote = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { noteId } = req.params;
    const { isArchived = true } = req.body;

    const aiNotes = await AINotes.findOne({ studentId });

    if (!aiNotes) {
      return res.status(404).json({
        success: false,
        message: 'No notes found'
      });
    }

    const note = aiNotes.notes.id(noteId);
    
    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    note.isArchived = isArchived;
    await aiNotes.save();

    res.json({
      success: true,
      message: isArchived ? 'Note archived successfully' : 'Note restored successfully'
    });

  } catch (error) {
    console.error('Archive note error:', error);
    res.status(500).json({
      success: false,
      message: 'Error archiving note',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Generate AI quiz
// @route   POST /api/ai/generate-quiz
export const generateAIQuiz = async (req, res) => {
  try {
    const { topic, difficulty, numQuestions = 10, includeExplanations = true } = req.body;
    const studentId = req.user.id;

    if (!topic) return res.status(400).json({ success: false, message: 'Topic is required' });

    const mentalState = await MentalState.findOne({ studentId });
    
    let adjustedDifficulty = difficulty;
    let adjustedQuestions = numQuestions;

    if (mentalState) {
      if (mentalState.currentState.stressLevel === 'high') {
        adjustedDifficulty = 'beginner';
        adjustedQuestions = Math.min(numQuestions, 5);
      } else if (mentalState.currentState.energyLevel === 'low') {
        adjustedDifficulty = 'beginner';
        adjustedQuestions = Math.min(numQuestions, 8);
      } else if (mentalState.currentState.motivationLevel === 'high') {
        adjustedDifficulty = 'advanced';
        adjustedQuestions = Math.min(numQuestions, 15);
      }
    }

    const generatedQuiz = await aiService.generateQuiz({
      topic,
      difficulty: adjustedDifficulty,
      numQuestions: adjustedQuestions,
      includeExplanations
    });

    const newQuiz = new Quiz({
      title: `${topic} Quiz`,
      topic,
      difficulty: adjustedDifficulty,
      questions: generatedQuiz.questions.map(q => ({
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        points: q.points || 1
      })),
      timeLimit: adjustedQuestions * 2,
      isAIGenerated: true,
      createdBy: studentId
    });

    await newQuiz.save();

    await Activity.findOneAndUpdate(
      { studentId },
      {
        $push: {
          activities: {
            type: 'quiz_generated',
            title: 'AI Quiz Generated',
            description: `Created a ${adjustedQuestions}-question quiz on ${topic}`,
            metadata: { topic, quizId: newQuiz._id, difficulty: adjustedDifficulty, numQuestions: adjustedQuestions },
            icon: '❓',
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
      data: {
        quizId: newQuiz._id,
        title: `${topic} Quiz`,
        questions: generatedQuiz.questions.map(({ correctAnswer, ...rest }) => rest),
        metadata: {
          topic,
          difficulty: adjustedDifficulty,
          totalQuestions: adjustedQuestions,
          adaptedFor: mentalState?.currentState?.motivationLevel === 'high' ? 'challenge' : 
                      mentalState?.currentState?.stressLevel === 'high' ? 'comfort' : 'balanced'
        }
      }
    });
  } catch (error) {
    console.error('AI quiz generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate quiz' });
  }
};

// backend/controllers/aiController.js - Add/update this function

export const generateLearningPath = async (req, res) => {
  try {
    const { topic, difficulty, goal, timeCommitment, learningStyle } = req.body;
    const studentId = req.user.id;

    if (!topic && !goal) {
      return res.status(400).json({ 
        success: false, 
        message: 'Topic is required' 
      });
    }

    const learningGoal = topic || goal;

    // Use your LearningPathService to generate the path
    const learningPath = await learningPathService.generatePath(studentId, {
      goal: learningGoal,
      difficulty: difficulty || 'intermediate',
      timeCommitment: timeCommitment || 5
    });

    res.json({
      success: true,
      data: learningPath,
      message: `Learning path for "${learningGoal}" generated successfully!`
    });

  } catch (error) {
    console.error('Generate learning path error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate learning path',
      error: error.message
    });
  }
};

// @desc    Recommend Topics
export const recommendTopics = async (req, res) => {
  try {
    const { interests, goals } = req.body;
    const studentId = req.user.id;

    const [quizHistory, mentalState, progress] = await Promise.all([
      QuizHistory.findOne({ studentId }),
      MentalState.findOne({ studentId }),
      StudentProgress.findOne({ studentId })
    ]);

    const recommendations = await aiService.recommendTopics({
      interests: interests || [],
      goals: goals || [],
      completedTopics: progress?.stats?.completedTopics || [],
      weakAreas: quizHistory?.statistics?.weakTopics || [],
      masteredTopics: quizHistory?.statistics?.topicsMastered || [],
      mentalState: mentalState?.currentState,
      timeAvailable: progress?.stats?.totalStudyTime || 0
    });

    let userRecommendations = await RecommendedTopics.findOne({ studentId });
    if (!userRecommendations) userRecommendations = new RecommendedTopics({ studentId, recommendations: [] });

    recommendations.forEach(rec => {
      userRecommendations.recommendations.push({
        ...rec,
        status: 'recommended',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
    });

    await userRecommendations.save();
    res.json({ success: true, data: { recommendations: recommendations.slice(0, 10) } });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate recommendations' });
  }
};

// @desc    Get mental health tip
export const getMentalHealthTip = async (req, res) => {
  try {
    const studentId = req.user.id;
    const mentalState = await MentalState.findOne({ studentId });

    if (!mentalState || mentalState.currentState.mood === 'unknown') {
      return res.json({
        success: true,
        data: {
          tip: "Take a moment to check in with yourself.",
          exercise: { name: "Quick Check-in", duration: "1 minute", steps: ["Breathe", "Notice"] }
        }
      });
    }

    const tip = await aiService.getMentalHealthTip(mentalState.currentState);
    if (mentalState.addMentalHealthTip) {
      mentalState.addMentalHealthTip(tip.tip, tip.category || 'general');
      await mentalState.save();
    }

    res.json({ success: true, data: tip });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate tip' });
  }
};

// @desc    Download notes
export const downloadNotes = async (req, res) => {
  try {
    const { noteId, format } = req.params;
    const studentId = req.user.id;

    const aiNotes = await AINotes.findOne({ studentId, 'notes._id': noteId });
    if (!aiNotes) return res.status(404).json({ success: false, message: 'Notes not found' });

    const note = aiNotes.notes.id(noteId);
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

    let content, contentType, filename;
    const baseName = note.topic.replace(/\s+/g, '_');

    switch (format) {
      case 'txt':
        contentType = 'text/plain';
        filename = `${baseName}_notes.txt`;
        content = generateTXT(note);
        break;
      case 'json':
        contentType = 'application/json';
        filename = `${baseName}_notes.json`;
        content = JSON.stringify(note, null, 2);
        break;
      case 'markdown':
        contentType = 'text/markdown';
        filename = `${baseName}_notes.md`;
        content = generateMarkdown(note);
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid format' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

// Helper function to generate TXT format
const generateTXT = (note) => {
  const lines = [note.title, '='.repeat(note.title.length), '', `TOPIC: ${note.topic}`, ''];
  // ... (Identical to your TXT logic)
  return lines.join('\n');
};

// Helper function to generate Markdown
const generateMarkdown = (note) => {
  const lines = [`# ${note.title}`, '', `**Topic:** ${note.topic}`];
  // ... (Identical to your Markdown logic)
  return lines.join('\n');
};


export const generateTeacherQuiz = async (req, res) => {
  try {
    const { subject, topic, difficulty = 'intermediate', numQuestions = 10 } = req.body;
    const teacherId = req.userId;

    const quizTopic = topic || subject;
    
    if (!quizTopic) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    // Normalise difficulty
    const difficultyMap = {
      beginner: 'beginner',
      easy: 'beginner',
      intermediate: 'intermediate',
      medium: 'intermediate',
      advanced: 'advanced',
      hard: 'advanced'
    };
    const normalisedDifficulty = difficultyMap[difficulty.toLowerCase()] || 'intermediate';

    // Call AI service (same as student version)
    const generatedQuiz = await aiService.generateQuiz({
      topic: quizTopic,
      difficulty: normalisedDifficulty,
      numQuestions: Math.min(Math.max(numQuestions, 5), 20)
    });

    if (!generatedQuiz || !generatedQuiz.questions || generatedQuiz.questions.length === 0) {
      throw new Error('Invalid AI response: missing questions array');
    }

    // ✅ Format questions for frontend (WITH correctAnswer as INDEX, not text)
    const formattedQuestions = generatedQuiz.questions.map((q, idx) => {
      // Ensure options are properly formatted
      let options = Array.isArray(q.options) && q.options.length === 4 
        ? q.options 
        : ['Option A', 'Option B', 'Option C', 'Option D'];
      
      // Find the correct answer index
      let correctIndex = 0;
      const correctAnswerText = q.correctAnswer || q.correct_answer;
      
      if (correctAnswerText) {
        // Strategy 1: Exact match
        let foundIndex = options.findIndex(opt => opt === correctAnswerText);
        
        // Strategy 2: Case-insensitive match
        if (foundIndex === -1) {
          foundIndex = options.findIndex(opt => 
            opt.toLowerCase() === correctAnswerText.toLowerCase()
          );
        }
        
        // Strategy 3: Partial match
        if (foundIndex === -1) {
          foundIndex = options.findIndex(opt => 
            opt.toLowerCase().includes(correctAnswerText.toLowerCase()) ||
            correctAnswerText.toLowerCase().includes(opt.toLowerCase())
          );
        }
        
        // Strategy 4: If correctAnswer is a number (0-3)
        if (foundIndex === -1 && !isNaN(parseInt(correctAnswerText))) {
          const numIndex = parseInt(correctAnswerText);
          if (numIndex >= 0 && numIndex <= 3) {
            foundIndex = numIndex;
          }
        }
        
        // Strategy 5: If correctAnswer is a letter (A, B, C, D)
        if (foundIndex === -1 && /^[A-Da-d]$/.test(correctAnswerText)) {
          const letterMap = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
          foundIndex = letterMap[correctAnswerText] || 0;
        }
        
        correctIndex = foundIndex !== -1 ? foundIndex : 0;
      }
      
      return {
        id: idx,
        text: q.question || `Question ${idx + 1}`,
        options: options,
        correctAnswer: correctIndex, // ✅ Return INDEX, not text
        explanation: q.explanation || '',
        points: q.points || 10,
        difficulty: normalisedDifficulty
      };
    });

    // ✅ Return questions to frontend WITHOUT saving to database
    return res.status(200).json({
      success: true,
      data: {
        questions: formattedQuestions,
        metadata: {
          topic: quizTopic,
          difficulty: normalisedDifficulty,
          numQuestions: formattedQuestions.length
        }
      }
    });

  } catch (error) {
    console.error('Teacher AI quiz generation error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate quiz. Please try again.'
    });
  }
};