/**
 * Topic Model
 * Central repository for educational content, including sections,
 * prerequisites, and popularity metrics.
 */

import mongoose from 'mongoose';
import constants from '../config/constants.js';

const topicSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Topic title is required'],
    trim: true,
    unique: true,
    minlength: [3, 'Title must be at least 3 characters'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Topic description is required'],
    trim: true,
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: constants.TOPIC_CATEGORIES,
    index: true
  },
  difficulty: {
    type: String,
    required: [true, 'Difficulty level is required'],
    enum: Object.values(constants.DIFFICULTY_LEVELS),
    default: constants.DIFFICULTY_LEVELS.BEGINNER,
    index: true
  },
  duration: {
    type: Number, // in minutes
    required: [true, 'Estimated duration is required'],
    min: [5, 'Duration must be at least 5 minutes'],
    max: [480, 'Duration cannot exceed 8 hours (480 minutes)'],
    default: 60
  },
  thumbnail: {
    type: String,
    default: 'default-topic-thumbnail.jpg'
  },
  tags: [{
    type: String,
    trim: true
  }],
  skills: [{
    type: String,
    trim: true
  }],
  
  prerequisites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    validate: {
      validator: async function(value) {
        if (!value) return true;
        const topic = await mongoose.model('Topic').findById(value);
        return topic !== null;
      },
      message: 'Prerequisite topic does not exist'
    }
  }],
  
  content: {
    overview: {
      type: String,
      required: [true, 'Topic overview is required'],
      minlength: [50, 'Overview must be at least 50 characters']
    },
    objectives: [{
      type: String,
      required: true
    }],
    sections: [{
      title: {
        type: String,
        required: true
      },
      content: {
        type: String,
        required: true
      },
      order: {
        type: Number,
        required: true
      },
      duration: {
        type: Number,
        default: 15
      },
      resources: [{
        title: String,
        url: String,
        type: {
          type: String,
          enum: ['video', 'article', 'documentation', 'image', 'pdf']
        },
        isRequired: {
          type: Boolean,
          default: false
        }
      }],
      codeExamples: [{
        title: String,
        language: String,
        code: String,
        explanation: String,
        output: String
      }],
      quiz: [{
        question: String,
        options: [String],
        correctAnswer: String,
        explanation: String,
        points: {
          type: Number,
          default: 1
        }
      }]
    }],
    summary: {
      type: String,
      required: [true, 'Topic summary is required']
    },
    keyTakeaways: [{
      type: String,
      required: true
    }],
    practiceExercises: [{
      title: String,
      description: String,
      difficulty: {
        type: String,
        enum: Object.values(constants.DIFFICULTY_LEVELS),
        default: constants.DIFFICULTY_LEVELS.BEGINNER
      },
      instructions: String,
      starterCode: String,
      solution: String,
      hints: [String],
      timeEstimate: Number 
    }],
    additionalResources: [{
      title: String,
      url: String,
      type: {
        type: String,
        enum: ['video', 'article', 'book', 'course', 'documentation', 'tool']
      },
      description: String,
      isFree: {
        type: Boolean,
        default: true
      },
      duration: Number,
      author: String,
      rating: {
        type: Number,
        min: 0,
        max: 5
      }
    }],
    discussion: {
      questions: [{
        question: String,
        hints: [String],
        isOptional: {
          type: Boolean,
          default: false
        }
      }],
      topics: [String]
    }
  },
  
  relatedTopics: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic'
  }],
  
  nextSteps: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic'
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPublished: {
    type: Boolean,
    default: true,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isAIGenerated: {
    type: Boolean,
    default: false
  },
  version: {
    type: Number,
    default: 1
  },
  
  enrolledStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  completedCount: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  ratings: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    review: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  views: {
    type: Number,
    default: 0
  },
  popularity: {
    type: Number,
    default: 0,
    index: true
  },
  keywords: [String],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// --- Virtual Fields ---

topicSchema.virtual('calculatedAverageRating').get(function() {
  if (!this.ratings || this.ratings.length === 0) return 0;
  const sum = this.ratings.reduce((acc, curr) => acc + (curr.rating || 0), 0);
  return (sum / this.ratings.length).toFixed(1);
});

topicSchema.virtual('enrolledCount').get(function() {
  return this.enrolledStudents?.length || 0;
});

topicSchema.virtual('completionRate').get(function() {
  if (!this.enrolledStudents || this.enrolledStudents.length === 0) return 0;
  return ((this.completedCount || 0) / this.enrolledStudents.length * 100).toFixed(1);
});

// --- Pre-save Middleware ---

topicSchema.pre('save', function(next) {
  this.keywords = [
    ...(this.title?.toLowerCase().split(' ') || []),
    ...(this.tags?.map(t => t?.toLowerCase()) || []),
    ...(this.skills?.map(s => s?.toLowerCase()) || []),
    this.category?.toLowerCase() || ''
  ].filter(k => k);
  
  this.lastUpdated = new Date();
  this.popularity = this.calculatePopularity();
  next();
});

// --- Instance Methods ---

topicSchema.methods = {
  calculatePopularity() {
    const viewWeight = 0.3;
    const enrollWeight = 0.4;
    const ratingWeight = 0.3;
    const recencyWeight = 0.2;
    
    const viewScore = Math.min((this.views || 0) / 1000, 100) * viewWeight;
    const enrollScore = Math.min((this.enrolledStudents?.length || 0) / 100, 100) * enrollWeight;
    const ratingScore = ((this.averageRating || 0) / 5) * 100 * ratingWeight;
    
    const daysOld = (Date.now() - (this.createdAt || Date.now())) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 100 - daysOld) * recencyWeight;
    
    return Math.min(100, (viewScore + enrollScore + ratingScore + recencyScore) || 0);
  },

  addRating(userId, rating, review = '') {
    if (!this.ratings) this.ratings = [];
    const existingRating = this.ratings.find(r => r.user?.toString() === userId?.toString());
    
    if (existingRating) {
      existingRating.rating = rating;
      existingRating.review = review;
      existingRating.createdAt = new Date();
    } else {
      this.ratings.push({ user: userId, rating, review, createdAt: new Date() });
    }
    
    const sum = this.ratings.reduce((acc, curr) => acc + (curr.rating || 0), 0);
    this.averageRating = sum / this.ratings.length;
    this.totalRatings = this.ratings.length;
    this.popularity = this.calculatePopularity();
  },

  incrementViews() {
    this.views = (this.views || 0) + 1;
    this.popularity = this.calculatePopularity();
  },

  enrollStudent(studentId) {
    if (!this.enrolledStudents) this.enrolledStudents = [];
    if (!this.enrolledStudents.includes(studentId)) {
      this.enrolledStudents.push(studentId);
      this.popularity = this.calculatePopularity();
    }
  },

  markCompleted(studentId) {
    if (!this.enrolledStudents) this.enrolledStudents = [];
    if (!this.enrolledStudents.includes(studentId)) {
      this.enrolledStudents.push(studentId);
    }
    this.completedCount = (this.completedCount || 0) + 1;
    this.popularity = this.calculatePopularity();
  },

  getStudentProgress(studentProgress) {
    if (!studentProgress || !Array.isArray(studentProgress)) {
      return { status: 'not_started', progress: 0, timeSpent: 0 };
    }
    const progress = studentProgress.find(p => p.topicId?.toString() === this._id.toString());
    return progress || { status: 'not_started', progress: 0, timeSpent: 0 };
  },

  async getPrerequisitesDetails() {
    if (!this.prerequisites || this.prerequisites.length === 0) return [];
    return await mongoose.model('Topic').find({ _id: { $in: this.prerequisites } }).select('title difficulty duration');
  },

  async getNextStepsDetails() {
    if (!this.nextSteps || this.nextSteps.length === 0) return [];
    return await mongoose.model('Topic').find({ _id: { $in: this.nextSteps } }).select('title difficulty duration');
  },

  arePrerequisitesMet(completedTopics = []) {
    if (!this.prerequisites || this.prerequisites.length === 0) return true;
    return this.prerequisites.every(prereq => completedTopics.includes(prereq.toString()));
  },

  getTotalDuration() {
    let total = this.duration || 0;
    if (this.content?.sections && Array.isArray(this.content.sections)) {
      total += this.content.sections.reduce((sum, section) => sum + (section.duration || 0), 0);
    }
    return total;
  },

  getSectionByOrder(order) {
    if (!this.content?.sections || !Array.isArray(this.content.sections)) return null;
    return this.content.sections.find(s => s.order === order);
  },

  getNextSection(currentOrder) {
    if (!this.content?.sections || !Array.isArray(this.content.sections)) return null;
    return this.content.sections.find(s => s.order === currentOrder + 1);
  }
};

// --- Static Methods ---

topicSchema.statics = {
  async findByDifficulty(difficulty) {
    return this.find({ difficulty, isPublished: true }).sort('-popularity').limit(20);
  },

  async findByCategory(category) {
    return this.find({ category, isPublished: true }).sort('-popularity').limit(20);
  },

  async getPopular(limit = 10) {
    return this.find({ isPublished: true }).sort('-popularity').limit(limit).select('title description category difficulty duration thumbnail popularity');
  },

  async getFeatured(limit = 5) {
    return this.find({ isFeatured: true, isPublished: true }).sort('-createdAt').limit(limit).select('title description category difficulty duration thumbnail');
  },

  async getNew(limit = 10) {
    return this.find({ isPublished: true }).sort('-createdAt').limit(limit).select('title description category difficulty duration thumbnail');
  },

  async searchTopics(query, filters = {}) {
    const searchFilter = { isPublished: true, ...filters };
    if (query) searchFilter.$text = { $search: query };
    return this.find(searchFilter).sort(query ? { score: { $meta: 'textScore' } } : '-popularity').limit(20).select('title description category difficulty duration thumbnail');
  },

  async getRecommendedForUser(completedTopics = [], interests = []) {
    const completedIds = completedTopics.map(t => t.toString());
    const query = { isPublished: true, _id: { $nin: completedIds } };
    if (interests.length > 0) query.category = { $in: interests };
    return this.find(query).sort('-popularity').limit(10).select('title description category difficulty duration thumbnail');
  },

  async getPrerequisitesChain(topicId) {
    const chain = [];
    let currentId = topicId;
    while (currentId) {
      const topic = await this.findById(currentId).select('title prerequisites');
      if (!topic) break;
      chain.unshift({ id: topic._id, title: topic.title });
      currentId = topic.prerequisites?.[0];
    }
    return chain;
  },

  async getLearningPath(targetTopicId) {
    const path = [];
    const visited = new Set();
    const buildPath = async (topicId) => {
      if (visited.has(topicId.toString())) return;
      visited.add(topicId.toString());
      const topic = await this.findById(topicId).select('title prerequisites difficulty');
      if (!topic) return;
      if (topic.prerequisites && topic.prerequisites.length > 0) {
        for (const prereqId of topic.prerequisites) await buildPath(prereqId);
      }
      path.push({ id: topic._id, title: topic.title, difficulty: topic.difficulty });
    };
    await buildPath(targetTopicId);
    return path;
  }
};

// --- Indexes ---
topicSchema.index({ title: 'text', description: 'text', 'content.overview': 'text', tags: 'text' });
topicSchema.index({ category: 1, difficulty: 1 });
topicSchema.index({ popularity: -1 });
topicSchema.index({ createdAt: -1 });
topicSchema.index({ 'ratings.rating': -1 });

const Topic = mongoose.model('Topic', topicSchema);
export default Topic;