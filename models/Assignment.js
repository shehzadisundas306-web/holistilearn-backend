// models/Assignment.js
import mongoose from "mongoose";
const assignmentSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: [true, 'Class ID is required']
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher ID is required']
  },
  title: {
    type: String,
    required: [true, 'Assignment title is required'],
    trim: true,
    minlength: [3, 'Title must be at least 3 characters'],
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [5000, 'Description cannot exceed 5000 characters'],
    default: ''
  },
  dueDate: {
    type: Date,
    validate: {
      validator: function(value) {
        if (!value) return true; // Due date is optional
        return value > new Date();
      },
      message: 'Due date must be in the future'
    }
  },
  totalPoints: {
    type: Number,
    required: [true, 'Total points are required'],
    min: [1, 'Total points must be at least 1'],
    max: [1000, 'Total points cannot exceed 1000'],
    default: 100
  },
  attachment: {
    url: {
      type: String,
      trim: true
    },
    fileName: {
      type: String,
      trim: true,
      maxlength: [255, 'File name too long']
    },
    fileType: String,
    fileSize: {
      type: Number,
      max: [50 * 1024 * 1024, 'File size cannot exceed 50MB'] // 50MB max
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  submissions: [{
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    submissionFile: {
      url: String,
      fileName: String
    },
    marks: {
      type: Number,
      min: 0,
      max: 1000
    },
    feedback: String,
    status: {
      type: String,
      enum: ['submitted', 'graded', 'late'],
      default: 'submitted'
    }
  }]
}, {
  timestamps: true
});

// Index for faster queries
assignmentSchema.index({ classId: 1, createdAt: -1 });
assignmentSchema.index({ teacherId: 1 });
assignmentSchema.index({ dueDate: 1 });

// Virtual for checking if assignment is overdue
assignmentSchema.virtual('isOverdue').get(function() {
  return this.dueDate && this.dueDate < new Date();
});

// Pre-save middleware
assignmentSchema.pre('save', function(next) {
  if (this.title) {
    this.title = this.title.trim();
  }
  if (this.description) {
    this.description = this.description.trim();
  }
  next();
});

export default mongoose.model('Assignment', assignmentSchema);