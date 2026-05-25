// backend/models/OnlineSession.js
import mongoose from 'mongoose';

const onlineSessionSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: [true, 'Class ID is required'],
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher ID is required'],
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  scheduledStart: {
    type: Date,
    required: [true, 'Start time is required'],
  },
  scheduledEnd: {
    type: Date,
    required: [true, 'End time is required'],
  },
  status: {
    type: String,
    enum: ['scheduled', 'live', 'ended', 'cancelled'],
    default: 'scheduled',
  },
  meetingLink: {
    type: String,
    default: null,
  },
  useJitsi: {
    type: Boolean,
    default: true,
  },
  activeParticipants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    role: { type: String, enum: ['teacher', 'student'], default: 'student' }
  }],
  attendance: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    duration: { type: Number, default: 0 },
  }],
  endedBy: {
    type: String,
    enum: ['teacher', 'auto', 'system', null],
    default: null,
  },
  endedAt: {
    type: Date,
    default: null,
  },
}, { 
  timestamps: true 
});

// Create indexes
onlineSessionSchema.index({ classId: 1 });
onlineSessionSchema.index({ teacherId: 1 });
onlineSessionSchema.index({ status: 1 });
onlineSessionSchema.index({ status: 1, scheduledEnd: 1 });
onlineSessionSchema.index({ teacherId: 1, status: 1 });

// Virtual for participant count
onlineSessionSchema.virtual('participantCount').get(function() {
  return this.activeParticipants.length;
});

// Virtual for is currently active
onlineSessionSchema.virtual('isActive').get(function() {
  return this.status === 'live';
});

// Method to check if session has ended
onlineSessionSchema.methods.hasEnded = function() {
  return this.status === 'ended' || this.status === 'cancelled';
};

// Method to check if session is live
onlineSessionSchema.methods.isLive = function() {
  return this.status === 'live';
};

// Method to check if session is scheduled
onlineSessionSchema.methods.isScheduled = function() {
  return this.status === 'scheduled';
};

// Method to end the session
onlineSessionSchema.methods.endSession = async function(endedBy = 'teacher') {
  this.status = 'ended';
  this.endedBy = endedBy;
  this.endedAt = new Date();
  
  for (const participant of this.activeParticipants) {
    const attendanceRecord = this.attendance.find(
      a => a.studentId?.toString() === participant.userId?.toString()
    );
    if (attendanceRecord && !attendanceRecord.leftAt) {
      attendanceRecord.leftAt = new Date();
      const duration = Math.floor((attendanceRecord.leftAt - attendanceRecord.joinedAt) / 1000 / 60);
      attendanceRecord.duration = duration;
    }
  }
  
  this.activeParticipants = [];
  await this.save();
  return this;
};

// Method to add a participant
onlineSessionSchema.methods.addParticipant = async function(userId, role = 'student') {
  const alreadyJoined = this.activeParticipants.some(
    p => p.userId?.toString() === userId.toString()
  );
  
  if (!alreadyJoined) {
    this.activeParticipants.push({
      userId,
      joinedAt: new Date(),
      role
    });
    
    if (role === 'student') {
      const alreadyInAttendance = this.attendance.some(
        a => a.studentId?.toString() === userId.toString()
      );
      if (!alreadyInAttendance) {
        this.attendance.push({
          studentId: userId,
          joinedAt: new Date()
        });
      }
    }
    
    await this.save();
  }
  
  return this;
};

// Method to remove a participant
onlineSessionSchema.methods.removeParticipant = async function(userId) {
  const participantIndex = this.activeParticipants.findIndex(
    p => p.userId?.toString() === userId.toString()
  );
  
  if (participantIndex !== -1) {
    const participant = this.activeParticipants[participantIndex];
    
    if (participant.role === 'student') {
      const attendanceRecord = this.attendance.find(
        a => a.studentId?.toString() === userId.toString()
      );
      if (attendanceRecord && !attendanceRecord.leftAt) {
        attendanceRecord.leftAt = new Date();
        const duration = Math.floor((attendanceRecord.leftAt - attendanceRecord.joinedAt) / 1000 / 60);
        attendanceRecord.duration = duration;
      }
    }
    
    this.activeParticipants.splice(participantIndex, 1);
    await this.save();
  }
  
  return this;
};

// ✅ NO PRE-SAVE MIDDLEWARE - Validation handled in controller

const OnlineSession = mongoose.model('OnlineSession', onlineSessionSchema);
export default OnlineSession;