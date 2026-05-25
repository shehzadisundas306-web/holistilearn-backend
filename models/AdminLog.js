import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: ['block_user', 'unblock_user', 'delete_user', 'approve_teacher', 
               'reject_teacher', 'delete_class', 'delete_quiz', 'update_settings', 'update_system_settings']
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    targetType: {
        type: String,
        enum: ['user', 'teacher', 'student', 'class', 'quiz', 'system'],
        default: 'user'  // ✅ Set default instead of requiring
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    ipAddress: {
        type: String,
        default: null
    },
    userAgent: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
adminLogSchema.index({ adminId: 1 });
adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ action: 1 });
adminLogSchema.index({ targetId: 1 });

export default mongoose.model('AdminLog', adminLogSchema);