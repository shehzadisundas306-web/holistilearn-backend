/**
 * Quiz Model
 * Manages assessment content, question banks, and performance metrics.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Quiz title is required'],
    trim: true
  },
  topic: {
    type: String,
    required: [true, 'Topic is required'],
    trim: true
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic'
  },
  difficulty: {
    type: String,
    required: [true, 'Difficulty level is required'],
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'intermediate'
  },
  questions: [{
    question: {
      type: String,
      required: true
    },
    options: [{
      type: String,
      required: true
    }],
    correctAnswer: {
      type: String,
      required: true
    },
    explanation: {
      type: String,
      default: ''
    },
    points: {
      type: Number,
      default: 1
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'intermediate'
    },
    category: {
      type: String,
      default: 'general'
    },
    tags: [String]
  }],
  timeLimit: {
    type: Number, // in minutes
    default: 30
  },
  totalAttempts: {
    type: Number,
    default: 0
  },
  averageScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  isAIGenerated: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  tags: [String],
  passingScore: {
    type: Number,
    default: 70,
    min: 0,
    max: 100
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  shuffleQuestions: {
    type: Boolean,
    default: false
  },
  shuffleOptions: {
    type: Boolean,
    default: false
  },
  feedbackEnabled: {
    type: Boolean,
    default: true
  },
//       teacherId: {
//   type: mongoose.Schema.Types.ObjectId,
//   ref: 'User',
//   required: true
// },
classId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Class', 
  required: false,
  default: null
},
// Add this new field to distinguish personal vs class quizzes
quizType: {
  type: String,
  enum: ['personal', 'class'],
  default: 'class'
},
// Add this field to your quizSchema:
isPersonal: {
  type: Boolean,
  default: false  // false = class quiz (teacher assigned), true = personal practice quiz
},
submissions: [{
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  score: Number,
  percentage: Number,
  submittedAt: Date,
  answers: Array
}],
isActive: { type: Boolean, default: true },
  metadata: {
    estimatedTime: Number,
    totalPoints: {
      type: Number,
      default: 0
    },
    difficultyDistribution: {
      easy: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      hard: { type: Number, default: 0 }
    },
    categoryDistribution: {
      type: Map,
      of: Number
    },
  }
}, {
  timestamps: true
});

// ============= INSTANCE METHODS =============

/**
 * Updates quiz statistics after a student completes an attempt.
 * @param {Number} score - The score achieved in the current attempt.
 */
quizSchema.methods.updateStats = function(score) {
  this.totalAttempts += 1;
  // Calculate rolling average
  this.averageScore = (this.averageScore * (this.totalAttempts - 1) + score) / this.totalAttempts;
  return this.save();
};

/**
 * Returns the quiz object without correct answers for delivery to the client.
 * @param {Boolean} includeAnswers - Whether to include correct answers (default: false)
 */
quizSchema.methods.getSanitizedQuiz = function(includeAnswers = false) {
  const quiz = this.toObject();
  
  if (!includeAnswers) {
    quiz.questions = quiz.questions.map(q => ({
      _id: q._id,
      question: q.question,
      options: q.options,
      explanation: q.explanation,
      points: q.points,
      difficulty: q.difficulty,
      category: q.category
      // correctAnswer is strictly excluded here
    }));
  }
  
  return quiz;
};

/**
 * Gets a random set of questions for practice mode
 * @param {Number} count - Number of questions to return
 * @returns {Array} Random questions
 */
quizSchema.methods.getRandomQuestions = function(count = 5) {
  const shuffled = [...this.questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
};

/**
 * Calculates the total points for the quiz
 * @returns {Number} Total points
 */
quizSchema.methods.calculateTotalPoints = function() {
  const total = this.questions.reduce((sum, q) => sum + (q.points || 1), 0);
  this.metadata.totalPoints = total;
  return total;
};

/**
 * Updates metadata distributions
 */
quizSchema.methods.updateMetadata = function() {
  const difficultyCount = { easy: 0, medium: 0, hard: 0 };
  const categoryCount = new Map();
  
  this.questions.forEach(q => {
    // Difficulty distribution
    difficultyCount[q.difficulty || 'medium']++;
    
    // Category distribution
    const category = q.category || 'general';
    categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
  });
  
  this.metadata.difficultyDistribution = difficultyCount;
  this.metadata.categoryDistribution = categoryCount;
  this.metadata.totalPoints = this.calculateTotalPoints();
  
  return this.metadata;
};

/**
 * Validates if a student can attempt the quiz
 * @param {Number} previousAttempts - Number of previous attempts by student
 * @returns {Object} Validation result
 */
quizSchema.methods.canAttempt = function(previousAttempts = 0) {
  if (!this.isPublished) {
    return { allowed: false, reason: 'Quiz is not published' };
  }
  
  if (previousAttempts >= this.maxAttempts) {
    return { allowed: false, reason: `Maximum attempts (${this.maxAttempts}) reached` };
  }
  
  return { allowed: true };
};

/**
 * Gets passing status based on score
 * @param {Number} score - Student's score
 * @returns {Boolean} Whether the student passed
 */
quizSchema.methods.isPassing = function(score) {
  return score >= this.passingScore;
};

// ============= STATIC METHODS =============

/**
 * Finds published quizzes by topic using a case-insensitive regex.
 * @param {String} topic - Topic name
 * @returns {Promise<Array>} Quizzes
 */
quizSchema.statics.findByTopic = function(topic) {
  return this.find({ 
    topic: { $regex: topic, $options: 'i' },
    isPublished: true 
  }).sort('-createdAt');
};

/**
 * Finds published quizzes by difficulty level.
 * @param {String} difficulty - Difficulty level
 * @returns {Promise<Array>} Quizzes
 */
quizSchema.statics.findByDifficulty = function(difficulty) {
  return this.find({ difficulty, isPublished: true }).sort('-createdAt');
};

/**
 * Finds quizzes created by a specific user
 * @param {String} userId - User ID
 * @returns {Promise<Array>} Quizzes
 */
quizSchema.statics.findByCreator = function(userId) {
  return this.find({ createdBy: userId }).sort('-createdAt');
};

/**
 * Gets popular quizzes (most attempts)
 * @param {Number} limit - Number of quizzes to return
 * @returns {Promise<Array>} Popular quizzes
 */
quizSchema.statics.getPopular = function(limit = 10) {
  return this.find({ isPublished: true })
    .sort({ totalAttempts: -1 })
    .limit(limit)
    .select('title topic difficulty totalAttempts averageScore');
};

/**
 * Gets quizzes by tags
 * @param {Array} tags - Tags to search for
 * @returns {Promise<Array>} Quizzes
 */
quizSchema.statics.findByTags = function(tags) {
  return this.find({ 
    tags: { $in: tags },
    isPublished: true 
  }).sort('-createdAt');
};

/**
 * Search quizzes by title or topic
 * @param {String} query - Search query
 * @returns {Promise<Array>} Matching quizzes
 */
quizSchema.statics.search = function(query) {
  return this.find({
    isPublished: true,
    $or: [
      { title: { $regex: query, $options: 'i' } },
      { topic: { $regex: query, $options: 'i' } },
      { tags: { $in: [new RegExp(query, 'i')] } }
    ]
  }).sort('-createdAt');
};

/**
 * Creates a quiz from AI-generated content
 * @param {Object} aiData - AI-generated quiz data
 * @param {String} userId - Creator user ID
 * @returns {Promise<Object>} Created quiz
 */
quizSchema.statics.createFromAI = async function(aiData, userId) {
  const quiz = new this({
    title: aiData.title,
    topic: aiData.topic,
    difficulty: aiData.difficulty,
    questions: aiData.questions,
    timeLimit: aiData.timeLimit || aiData.questions.length * 2,
    isAIGenerated: true,
    createdBy: userId,
    tags: [aiData.topic, aiData.difficulty]
  });
  
  quiz.updateMetadata();
  await quiz.save();
  
  return quiz;
};

/**
 * Duplicates a quiz (for teachers to create variations)
 * @param {String} quizId - Original quiz ID
 * @param {String} newTitle - Title for the duplicate
 * @param {String} userId - User ID of the creator
 * @returns {Promise<Object>} Duplicated quiz
 */
quizSchema.statics.duplicate = async function(quizId, newTitle, userId) {
  const original = await this.findById(quizId);
  if (!original) throw new Error('Quiz not found');
  
  const quizData = original.toObject();
  delete quizData._id;
  delete quizData.createdAt;
  delete quizData.updatedAt;
  delete quizData.totalAttempts;
  delete quizData.averageScore;
  
  quizData.title = newTitle || `${original.title} (Copy)`;
  quizData.createdBy = userId;
  quizData.isPublished = false;
  quizData.isAIGenerated = false;
  
  const duplicate = new this(quizData);
  duplicate.updateMetadata();
  await duplicate.save();
  
  return duplicate;
};

// ============= VIRTUAL PROPERTIES =============

// Virtual for question count
quizSchema.virtual('questionCount').get(function() {
  return this.questions.length;
});

// Virtual for total possible points
quizSchema.virtual('totalPossiblePoints').get(function() {
  return this.questions.reduce((sum, q) => sum + (q.points || 1), 0);
});

// Virtual for difficulty rating (0-1, where 1 is hardest)
quizSchema.virtual('difficultyRating').get(function() {
  const difficultyMap = { beginner: 0.3, intermediate: 0.6, advanced: 0.9 };
  return difficultyMap[this.difficulty] || 0.6;
});

// ============= PRE-SAVE MIDDLEWARE =============

// Update metadata before saving
quizSchema.pre('save', function() {
  if (this.isModified('questions')) {
    this.updateMetadata();
  }
  // next();
});

// ============= INDEXES =============
quizSchema.index({ topic: 1 });
quizSchema.index({ difficulty: 1 });
quizSchema.index({ createdBy: 1 });
quizSchema.index({ createdAt: -1 });
quizSchema.index({ tags: 1 });
quizSchema.index({ isPublished: 1 });
quizSchema.index({ totalAttempts: -1 });

const Quiz = mongoose.model('Quiz', quizSchema);
export default Quiz;