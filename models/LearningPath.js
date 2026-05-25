// backend/models/LearningPath.js
import mongoose from 'mongoose';

// Define constants
const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];
const TOPIC_STATUS = ['pending', 'in_progress', 'completed'];
const MILESTONE_STATUS = ['locked', 'available', 'in_progress', 'completed', 'paused'];
const PATH_STATUS = ['not_started', 'in_progress', 'paused', 'completed', 'archived'];

// Resource schema
const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, enum: ['video', 'article', 'documentation', 'course', 'book'], default: 'article' },
  url: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  isRequired: { type: Boolean, default: true }
}, { _id: false });

// Practice exercise schema
const practiceExerciseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  difficulty: { type: String, enum: DIFFICULTY_LEVELS, default: 'beginner' },
  estimatedTime: { type: Number, default: 30 }
}, { _id: false });

// Topic schema
const topicSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  difficulty: { type: String, enum: DIFFICULTY_LEVELS, default: 'intermediate' },
  estimatedTime: { type: Number, default: 60 },
  resources: [resourceSchema],
  practiceExercises: [practiceExerciseSchema],
  skills: { type: [String], default: [] },
  status: { type: String, enum: TOPIC_STATUS, default: 'pending' },
  startedAt: { type: Date },
  completedAt: { type: Date },
  timeSpent: { type: Number, default: 0 },
  quizIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' }],
  passingScore: { type: Number, default: 70 },
  notes: { type: [String], default: [] }
});

// Quiz attempt schema
const quizAttemptSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  score: { type: Number, required: true },
  passed: { type: Boolean, required: true }
}, { _id: false });

// Quiz schema
const quizSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
  title: { type: String, required: true },
  required: { type: Boolean, default: true },
  passingScore: { type: Number, default: 70 },
  attempts: [quizAttemptSchema],
  status: { type: String, enum: ['pending', 'passed', 'failed'], default: 'pending' }
});

// Project submission schema
const projectSubmissionSchema = new mongoose.Schema({
  url: { type: String },
  submittedAt: { type: Date },
  feedback: { type: String },
  score: { type: Number }
}, { _id: false });

// Project schema
const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  requirements: { type: [String], default: [] },
  resources: { type: [String], default: [] },
  deliverables: { type: [String], default: [] },
  estimatedTime: { type: Number, default: 120 },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  submission: projectSubmissionSchema
});

// Milestone schema
const milestoneSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  order: { type: Number, default: 0 },
  status: { type: String, enum: MILESTONE_STATUS, default: 'locked' },
  prerequisites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LearningPath.milestones' }],
  topics: [topicSchema],
  quizzes: [quizSchema],
  projects: [projectSchema],
  estimatedTime: { type: Number, default: 0 },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  startedAt: { type: Date },
  completedAt: { type: Date },
  deadline: { type: Date },
  skills: { type: [String], default: [] }
});

// ✅ NEW: Individual Path Schema (for multiple paths support)
const pathSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  goal: { type: String, required: true },
  description: { type: String, default: '' },
  difficulty: { type: String, enum: DIFFICULTY_LEVELS, default: 'intermediate' },
  estimatedDuration: {
    value: { type: Number, default: 4 },
    unit: { type: String, enum: ['days', 'weeks', 'months'], default: 'weeks' }
  },
  milestones: [milestoneSchema],
  progress: { type: Number, default: 0, min: 0, max: 100 },
  status: { type: String, enum: PATH_STATUS, default: 'not_started' },
  startedAt: { type: Date, default: Date.now },
  lastAccessedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  lastUpdated: { type: Date, default: Date.now }
});

// AI recommendation adaptation schema
const adaptationSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  reason: { type: String },
  changes: { type: [String], default: [] }
}, { _id: false });

// Suggested resource schema
const suggestedResourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String },
  url: { type: String },
  reason: { type: String }
}, { _id: false });

// AI recommendations schema
const aiRecommendationsSchema = new mongoose.Schema({
  lastGenerated: { type: Date, default: Date.now },
  adaptations: [adaptationSchema],
  learningPace: { type: String, enum: ['slow', 'moderate', 'fast'], default: 'moderate' },
  focusAreas: { type: [String], default: [] },
  suggestedResources: [suggestedResourceSchema]
});

// Settings schema
const settingsSchema = new mongoose.Schema({
  notifications: {
    milestoneReminder: { type: Boolean, default: true },
    deadlineAlert: { type: Boolean, default: true },
    weeklyProgress: { type: Boolean, default: true }
  },
  preferredStudyTime: { type: String, enum: ['morning', 'afternoon', 'evening', 'night'], default: 'morning' },
  dailyGoal: { type: Number, default: 60 },
  adaptivePacing: { type: Boolean, default: true }
});

// ✅ MAIN LEARNING PATH SCHEMA - Supports multiple paths
const learningPathSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  // ✅ Multiple paths stored in an array
  paths: [pathSchema],
  // ✅ Reference to currently active path
  currentPathId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningPath.paths',
    default: null
  },
  // Legacy support for backward compatibility
  completedPaths: [{
    goal: String,
    description: String,
    difficulty: String,
    duration: Number,
    startedAt: Date,
    completedAt: Date,
    milestonesCompleted: Number,
    topicsCovered: [String],
    skillsGained: [String],
    achievements: [String]
  }],
  recommendedPaths: [{
    title: String,
    description: String,
    difficulty: String,
    estimatedDuration: String,
    topics: [String],
    skills: [String],
    careerOpportunities: [String],
    prerequisites: [String],
    matchScore: Number,
    reason: String
  }],
  aiRecommendations: {
    type: aiRecommendationsSchema,
    default: () => ({})
  },
  settings: {
    type: settingsSchema,
    default: () => ({})
  }
}, { timestamps: true });

// ============= HELPER METHODS =============

// Get current path
learningPathSchema.methods.getCurrentPath = function() {
  if (!this.currentPathId) return null;
  return this.paths.find(p => p._id.toString() === this.currentPathId.toString());
};

// Set current path
learningPathSchema.methods.setCurrentPath = function(pathId) {
  const pathExists = this.paths.some(p => p._id.toString() === pathId);
  if (pathExists) {
    this.currentPathId = pathId;
    const path = this.paths.find(p => p._id.toString() === pathId);
    if (path) {
      path.lastAccessedAt = new Date();
      if (path.status === 'not_started') {
        path.status = 'in_progress';
      }
    }
    return true;
  }
  return false;
};

// Add new path
learningPathSchema.methods.addPath = function(pathData) {
  const newPath = {
    _id: new mongoose.Types.ObjectId(),
    ...pathData,
    status: 'not_started',
    startedAt: new Date(),
    lastAccessedAt: new Date(),
    progress: 0
  };
  this.paths.push(newPath);
  return newPath;
};

// Calculate and update path progress
learningPathSchema.methods.updatePathProgress = function(pathId) {
  const path = this.paths.find(p => p._id.toString() === pathId);
  if (!path) return 0;
  
  let totalMilestoneProgress = 0;
  path.milestones.forEach(milestone => {
    totalMilestoneProgress += milestone.progress || 0;
  });
  
  const newProgress = path.milestones.length > 0 
    ? totalMilestoneProgress / path.milestones.length 
    : 0;
  
  path.progress = newProgress;
  path.lastUpdated = new Date();
  
  // Update status based on progress
  if (newProgress >= 100) {
    path.status = 'completed';
    path.completedAt = new Date();
  } else if (newProgress > 0 && path.status === 'not_started') {
    path.status = 'in_progress';
  }
  
  return newProgress;
};

// Calculate overall progress for a milestone
learningPathSchema.methods.updateMilestoneProgress = function(pathId, milestoneId) {
  const path = this.paths.find(p => p._id.toString() === pathId);
  if (!path) return;
  
  const milestone = path.milestones.find(m => m._id.toString() === milestoneId);
  if (!milestone) return;
  
  const totalTopics = milestone.topics?.length || 0;
  const completedTopics = milestone.topics?.filter(t => t.status === 'completed').length || 0;
  milestone.progress = totalTopics > 0 ? (completedTopics / totalTopics) * 100 : 0;
  
  // Check if milestone is completed
  const allTopicsCompleted = milestone.topics?.every(t => t.status === 'completed') ?? true;
  const allQuizzesPassed = milestone.quizzes?.every(q => q.status === 'passed') ?? true;
  const allProjectsCompleted = milestone.projects?.every(p => p.status === 'completed') ?? true;
  
  if (allTopicsCompleted && allQuizzesPassed && allProjectsCompleted) {
    milestone.status = 'completed';
    milestone.completedAt = new Date();
    
    // Unlock next milestone
    const currentIndex = path.milestones.findIndex(m => m._id.toString() === milestoneId);
    if (currentIndex >= 0 && currentIndex < path.milestones.length - 1) {
      const nextMilestone = path.milestones[currentIndex + 1];
      if (nextMilestone.status === 'locked') {
        nextMilestone.status = 'available';
      }
    }
  }
  
  // Update overall path progress
  this.updatePathProgress(pathId);
};

// Delete a path
learningPathSchema.methods.deletePath = function(pathId) {
  const pathIndex = this.paths.findIndex(p => p._id.toString() === pathId);
  if (pathIndex === -1) return false;
  
  // If deleting current path, clear reference
  if (this.currentPathId && this.currentPathId.toString() === pathId) {
    this.currentPathId = null;
  }
  
  this.paths.splice(pathIndex, 1);
  return true;
};

// Get all paths by status
learningPathSchema.methods.getPathsByStatus = function(status) {
  return this.paths.filter(p => p.status === status);
};

// Check if a path exists
learningPathSchema.methods.pathExists = function(goal) {
  return this.paths.some(p => p.goal.toLowerCase() === goal.toLowerCase());
};

// Get path by goal
learningPathSchema.methods.getPathByGoal = function(goal) {
  return this.paths.find(p => p.goal.toLowerCase() === goal.toLowerCase());
};

// Legacy methods for backward compatibility
learningPathSchema.methods.calculateProgress = function() {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return 0;
  return currentPath.progress;
};

learningPathSchema.methods.checkPrerequisites = function(milestoneIndex) {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return true;
  
  const milestone = currentPath.milestones?.[milestoneIndex];
  if (!milestone || !milestone.prerequisites || milestone.prerequisites.length === 0) {
    return true;
  }
  
  return milestone.prerequisites.every(prereqId => {
    const prereqMilestone = currentPath.milestones.find(m => m._id.toString() === prereqId.toString());
    return prereqMilestone && prereqMilestone.status === 'completed';
  });
};

learningPathSchema.methods.updateMilestoneStatus = function(milestoneId) {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return;
  
  this.updateMilestoneProgress(currentPath._id, milestoneId);
  return this.save();
};

learningPathSchema.methods.startTopic = function(milestoneId, topicIndex) {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return null;
  
  const milestone = currentPath.milestones.find(m => m._id.toString() === milestoneId);
  if (!milestone) return null;
  
  const topic = milestone.topics?.[topicIndex];
  if (!topic) return null;
  
  topic.status = 'in_progress';
  topic.startedAt = new Date();
  
  if (milestone.status === 'locked') {
    milestone.status = 'in_progress';
    milestone.startedAt = milestone.startedAt || new Date();
  }
  
  return topic;
};

learningPathSchema.methods.completeTopic = function(milestoneId, topicIndex, timeSpent) {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return null;
  
  const milestone = currentPath.milestones.find(m => m._id.toString() === milestoneId);
  if (!milestone) return null;
  
  const topic = milestone.topics?.[topicIndex];
  if (!topic) return null;
  
  topic.status = 'completed';
  topic.completedAt = new Date();
  topic.timeSpent = (topic.timeSpent || 0) + (timeSpent || 0);
  
  this.updateMilestoneProgress(currentPath._id, milestoneId);
  
  return topic;
};

learningPathSchema.methods.addQuizAttempt = function(milestoneId, quizId, score, passed) {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return;
  
  const milestone = currentPath.milestones.find(m => m._id.toString() === milestoneId);
  if (!milestone) return;
  
  const quiz = milestone.quizzes?.find(q => q.quizId?.toString() === quizId.toString());
  if (quiz) {
    quiz.attempts.push({ date: new Date(), score, passed });
    if (passed) quiz.status = 'passed';
    this.updateMilestoneProgress(currentPath._id, milestoneId);
  }
};

learningPathSchema.methods.getCurrentMilestone = function() {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return null;
  return currentPath.milestones.find(m => m.status === 'in_progress') ||
         currentPath.milestones.find(m => m.status === 'available');
};

learningPathSchema.methods.getNextMilestone = function() {
  const currentPath = this.getCurrentPath();
  if (!currentPath) return null;
  
  const currentIndex = currentPath.milestones.findIndex(
    m => m.status === 'in_progress' || m.status === 'available'
  );
  
  if (currentIndex >= 0 && currentIndex < currentPath.milestones.length - 1) {
    return currentPath.milestones[currentIndex + 1];
  }
  return null;
};

learningPathSchema.methods.getNextSteps = function() {
  const steps = [];
  const currentMilestone = this.getCurrentMilestone();
  
  if (currentMilestone) {
    const nextTopic = currentMilestone.topics?.find(t => t.status === 'pending');
    if (nextTopic) {
      steps.push({
        type: 'topic',
        title: nextTopic.title,
        milestone: currentMilestone.title,
        estimatedTime: nextTopic.estimatedTime
      });
    }
    
    const nextQuiz = currentMilestone.quizzes?.find(q => q.status === 'pending');
    if (nextQuiz) {
      steps.push({
        type: 'quiz',
        title: nextQuiz.title,
        milestone: currentMilestone.title
      });
    }
    
    const nextProject = currentMilestone.projects?.find(p => p.status === 'pending');
    if (nextProject) {
      steps.push({
        type: 'project',
        title: nextProject.title,
        milestone: currentMilestone.title,
        estimatedTime: nextProject.estimatedTime
      });
    }
  }
  
  return steps;
};

// Indexes
learningPathSchema.index({ 'paths.status': 1 });
learningPathSchema.index({ 'paths.milestones.status': 1 });
learningPathSchema.index({ currentPathId: 1 });

const LearningPath = mongoose.model('LearningPath', learningPathSchema);

export default LearningPath;