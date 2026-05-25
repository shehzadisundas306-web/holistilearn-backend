import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    token: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: '30d' // Auto-delete sessions after 30 days
    },
    lastActivity: {
        type: Date,
        default: Date.now
    }
});

// Index for faster queries
sessionSchema.index({ userId: 1 });
sessionSchema.index({ createdAt: 1 });

export const Session = mongoose.model("Session", sessionSchema);