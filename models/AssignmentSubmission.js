// backend/models/AssignmentSubmission.js
import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  submissionFile: {
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number }
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  marks: {
    type: Number,
    min: 0,
    default: null
  },
  feedback: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['submitted', 'graded', 'late'],
    default: 'submitted'
  },
  isLate: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate submissions
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

// Index for queries
submissionSchema.index({ assignmentId: 1, status: 1 });
submissionSchema.index({ studentId: 1, submittedAt: -1 });

export default mongoose.model('AssignmentSubmission', submissionSchema);