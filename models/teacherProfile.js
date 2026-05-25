// backend/models/TeacherProfile.js
import mongoose from 'mongoose';

const teacherProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    degree: {
        type: String,
        required: [true, 'Degree is required'],
        trim: true
    },
    specialization: {
        type: String,
        required: [true, 'Specialization is required'],
        trim: true
    },
    experience: {
        type: Number,
        required: [true, 'Experience is required'],
        min: 0,
        max: 50
    },
    bio: {
        type: String,
        required: [true, 'Bio is required'],
        maxlength: [500, 'Bio cannot exceed 500 characters'],
        trim: true
    },
    subjects: [{
        type: String,
        trim: true
    }],
    topics: [{
        subject: String,
        topicName: String
    }],
    isProfileComplete: {
        type: Boolean,
        default: false
    },
    // ✅ Add approval fields
    isApproved: {
        type: Boolean,
        default: false
    },
    approvedAt: {
        type: Date,
        default: null
    },
    rejectionReason: {
        type: String,
        default: ''
    },
    rejectedAt: {
        type: Date,
        default: null
    },
    profilePicture: {
        type: String,
        default: null
    },
    ratings: {
        average: { type: Number, default: 0 },
        count: { type: Number, default: 0 }
    },
    totalStudents: {
        type: Number,
        default: 0
    },
    totalClasses: {
        type: Number,
        default: 0
    },
    settings: {
        emailNotifications: { type: Boolean, default: true },
        pushNotifications: { type: Boolean, default: true },
        profileVisibility: { type: String, enum: ['public', 'private'], default: 'public' }
    }
}, {
    timestamps: true
});

// Indexes for faster queries
teacherProfileSchema.index({ userId: 1 });
teacherProfileSchema.index({ specialization: 1 });
teacherProfileSchema.index({ subjects: 1 });
teacherProfileSchema.index({ 'ratings.average': -1 });
teacherProfileSchema.index({ isApproved: 1 });

const TeacherProfile = mongoose.model('TeacherProfile', teacherProfileSchema);
export default TeacherProfile;