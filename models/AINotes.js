/**
 * AI Notes Model
 * Stores and manages AI-generated study materials, formatting, and usage statistics.
 */

import mongoose from 'mongoose';

const aiNotesSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  notes: [{
    topic: {
      type: String,
      required: true,
      trim: true
    },
    title: {
      type: String,
      required: true
    },
    content: {
      overview: {
        type: String,
        default: ''
      },
      // Fixed: Mixed type for flexible key points
      keyPoints: {
        type: [mongoose.Schema.Types.Mixed],
        default: []
      },
      // Fixed: Mixed type for flexible explanations
      detailedExplanation: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      codeExamples: [{
        title: String,
        language: String,
        code: String,
        explanation: String,
        output: String,
        tryItYourself: String
      }],
      visualAids: [{
        type: {
          type: String,
          enum: ['diagram', 'chart', 'mindmap', 'flowchart']
        },
        description: String,
        url: String,
        ascii: String
      }],
      practiceQuestions: [{
        question: String,
        answer: String,
        hint: String,
        difficulty: String,
        type: {
          type: String,
          enum: ['multiple_choice', 'coding', 'theoretical']
        }
      }],
      summary: {
        type: String,
        default: ''
      },
      furtherReading: [{
        title: String,
        url: String,
        type: {
          type: String,
          enum: ['article', 'video', 'documentation', 'course']
        },
        duration: String
      }],
      relatedTopics: [String]
    },
    metadata: {
      difficulty: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        required: true
      },
      estimatedReadTime: Number, // in minutes
      generatedAt: {
        type: Date,
        default: Date.now
      },
      lastAccessed: Date,
      accessCount: {
        type: Number,
        default: 0
      },
      downloadCount: {
        type: Number,
        default: 0
      },
      rating: {
        average: {
          type: Number,
          min: 0,
          max: 5,
          default: 0
        },
        count: {
          type: Number,
          default: 0
        }
      },
      tags: [String],
      language: {
        type: String,
        default: 'en'
      },
      version: {
        type: Number,
        default: 1
      }
    },
    formats: {
      pdf: { url: String, size: Number, generatedAt: Date },
      txt: { url: String, size: Number, generatedAt: Date },
      json: { url: String, size: Number, generatedAt: Date },
      markdown: { url: String, size: Number, generatedAt: Date }
    },
    aiMetadata: {
      model: String,
      prompt: String,
      tokensUsed: Number,
      cost: Number,
      processingTime: Number
    },
    feedback: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      rating: Number,
      comment: String,
      helpful: Boolean,
      reportedIssues: [String],
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    isPublic: {
      type: Boolean,
      default: false
    },
    isArchived: {
      type: Boolean,
      default: false
    }
  }],
  statistics: {
    totalNotes: {
      type: Number,
      default: 0
    },
    totalTopics: [String],
    mostAccessedNotes: [{
      noteId: mongoose.Schema.Types.ObjectId,
      title: String,
      accessCount: Number
    }],
    favoriteTopics: [{
      topic: String,
      count: Number
    }],
    averageRating: {
      type: Number,
      default: 0
    },
    totalDownloads: {
      type: Number,
      default: 0
    },
    studyTime: {
      type: Number,
      default: 0 // total minutes spent reading notes
    }
  }
}, {
  timestamps: true
});

// --- Schema Methods ---

// Helper method to format notes for display
aiNotesSchema.methods.formatKeyPoints = function(noteId) {
  const note = this.notes.id(noteId);
  if (!note) return [];
  
  const keyPoints = note.content.keyPoints || [];
  
  return keyPoints.map(point => {
    if (typeof point === 'string') {
      return { point, explanation: '', importance: 'medium' };
    }
    return point;
  });
};

// Helper method to get detailed explanation as text
aiNotesSchema.methods.getExplanationText = function(noteId) {
  const note = this.notes.id(noteId);
  if (!note) return '';
  
  const explanation = note.content.detailedExplanation;
  
  if (typeof explanation === 'string') return explanation;
  
  if (explanation?.sections) {
    return explanation.sections.map(s => s.content).join('\n\n');
  }
  
  return explanation?.text || '';
};

// Update access statistics
aiNotesSchema.methods.noteAccessed = function(noteId, timeSpent = 0) {
  const note = this.notes.id(noteId);
  if (note) {
    note.metadata.lastAccessed = new Date();
    note.metadata.accessCount += 1;
    this.statistics.studyTime += timeSpent;
    
    const mostAccessed = this.statistics.mostAccessedNotes;
    const existing = mostAccessed.find(n => n.noteId.toString() === noteId.toString());
    
    if (existing) {
      existing.accessCount = note.metadata.accessCount;
    } else {
      mostAccessed.push({
        noteId: note._id,
        title: note.title,
        accessCount: note.metadata.accessCount
      });
    }
    
    mostAccessed.sort((a, b) => b.accessCount - a.accessCount);
    if (mostAccessed.length > 5) mostAccessed.pop();
  }
};

// Increment download count
aiNotesSchema.methods.noteDownloaded = function(noteId) {
  const note = this.notes.id(noteId);
  if (note) {
    note.metadata.downloadCount += 1;
    this.statistics.totalDownloads += 1;
  }
};

// Add rating to note
aiNotesSchema.methods.addRating = function(noteId, rating, comment = null) {
  const note = this.notes.id(noteId);
  if (note) {
    note.feedback.push({
      rating,
      comment,
      createdAt: new Date()
    });
    
    const total = note.feedback.reduce((sum, f) => sum + f.rating, 0);
    note.metadata.rating.average = total / note.feedback.length;
    note.metadata.rating.count = note.feedback.length;
    
    const allRatings = this.notes.flatMap(n => n.feedback.map(f => f.rating));
    if (allRatings.length > 0) {
      this.statistics.averageRating = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;
    }
  }
};

// Search notes by topic or content
aiNotesSchema.methods.searchNotes = function(query) {
  const lowQuery = query.toLowerCase();
  const results = this.notes.filter(note => {
    return note.topic.toLowerCase().includes(lowQuery) ||
           note.title.toLowerCase().includes(lowQuery) ||
           note.content.overview.toLowerCase().includes(lowQuery) ||
           note.metadata.tags.some(tag => tag.toLowerCase().includes(lowQuery));
  });
  
  return results.sort((a, b) => b.metadata.accessCount - a.metadata.accessCount);
};

// Get notes by topic
aiNotesSchema.methods.getNotesByTopic = function(topic) {
  return this.notes
    .filter(note => note.topic.toLowerCase() === topic.toLowerCase())
    .sort((a, b) => b.metadata.generatedAt - a.metadata.generatedAt);
};

// Get recent notes
aiNotesSchema.methods.getRecentNotes = function(limit = 5) {
  return this.notes
    .filter(n => !n.isArchived)
    .sort((a, b) => b.metadata.generatedAt - a.metadata.generatedAt)
    .slice(0, limit);
};

// Get popular notes
aiNotesSchema.methods.getPopularNotes = function(limit = 5) {
  return this.notes
    .filter(n => !n.isArchived)
    .sort((a, b) => b.metadata.accessCount - a.metadata.accessCount)
    .slice(0, limit);
};

// Archive old notes
aiNotesSchema.methods.archiveNotes = function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  this.notes.forEach(note => {
    if (note.metadata.generatedAt < cutoffDate && note.metadata.accessCount === 0) {
      note.isArchived = true;
    }
  });
};

// Get study recommendations based on note history
aiNotesSchema.methods.getNoteRecommendations = function() {
  const topicCounts = {};
  this.notes.forEach(note => {
    if (note.metadata.accessCount > 0) {
      topicCounts[note.topic] = (topicCounts[note.topic] || 0) + note.metadata.accessCount;
    }
  });
  
  const favoriteTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);
  
  return favoriteTopics.map(topic => ({
    topic,
    reason: `You've shown interest in ${topic}`,
    relatedNotes: this.getNotesByTopic(topic).slice(0, 2)
  }));
};

// Generate study plan from notes
aiNotesSchema.methods.generateStudyPlan = function(days = 7) {
  const unreadNotes = this.notes.filter(n => n.metadata.accessCount === 0 && !n.isArchived);
  const plan = [];
  const notesPerDay = Math.ceil(unreadNotes.length / days);
  
  for (let i = 0; i < days; i++) {
    const dayNotes = unreadNotes.slice(i * notesPerDay, (i + 1) * notesPerDay);
    if (dayNotes.length > 0) {
      plan.push({
        day: i + 1,
        date: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
        notes: dayNotes.map(n => ({
          id: n._id,
          title: n.title,
          topic: n.topic,
          estimatedTime: n.metadata.estimatedReadTime,
          difficulty: n.metadata.difficulty
        })),
        totalTime: dayNotes.reduce((sum, n) => sum + (n.metadata.estimatedReadTime || 10), 0)
      });
    }
  }
  return plan;
};

// --- Indexes ---
// aiNotesSchema.index({ studentId: 1, 'notes.topic': 1 });
aiNotesSchema.index({ 'notes.metadata.generatedAt': -1 });
aiNotesSchema.index({ 'notes.metadata.tags': 1 });

const AINotes = mongoose.model('AINotes', aiNotesSchema);
export default AINotes;