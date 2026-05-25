// backend/models/Enrollment.js
import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  joinedAt: { type: Date, default: Date.now },
  progress: {
    quizzesCompleted: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now }
  },
  status: { type: String, enum: ['active', 'dropped'], default: 'active' }
});

enrollmentSchema.index({ studentId: 1, classId: 1 }, { unique: true });

export default mongoose.model('Enrollment', enrollmentSchema);