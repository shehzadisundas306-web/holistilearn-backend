import mongoose from 'mongoose';

const classSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    className: {
        type: String,
        required: [true, 'Class name is required'],
        trim: true
    },
    subject: {
        type: String,
        required: [true, 'Subject is required'],
        trim: true
    },
    topic: {
        type: String,
        required: [true, 'Topic is required'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    classCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    coverImage: {
        type: String,
        default: null
    },
    students: [{
        studentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        progress: {
            quizzesCompleted: { type: Number, default: 0 },
            averageScore: { type: Number, default: 0 },
            lastActive: { type: Date, default: Date.now }
        }
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    settings: {
        allowLateSubmission: { type: Boolean, default: true },
        defaultQuizTimeLimit: { type: Number, default: 30 },
        requireApproval: { type: Boolean, default: false }
    },
    schedule: {
        startDate: Date,
        endDate: Date,
        meetingTime: String,
        meetingLink: String
    }
}, {
    timestamps: true
});

// Indexes
classSchema.index({ classCode: 1 });
classSchema.index({ teacherId: 1 });
classSchema.index({ 'students.studentId': 1 });
classSchema.index({ subject: 1 });
classSchema.index({ isActive: 1 });

// Virtual for student count
classSchema.virtual('studentCount').get(function() {
    return this.students.length;
});

// Method to add student
classSchema.methods.addStudent = async function(studentId) {
    const alreadyEnrolled = this.students.some(s => s.studentId.toString() === studentId);
    if (!alreadyEnrolled) {
        this.students.push({ studentId });
        await this.save();
        return true;
    }
    return false;
};

// Method to remove student
classSchema.methods.removeStudent = async function(studentId) {
    this.students = this.students.filter(s => s.studentId.toString() !== studentId);
    await this.save();
    return true;
};

// Method to update student progress
classSchema.methods.updateStudentProgress = async function(studentId, quizScore) {
    const student = this.students.find(s => s.studentId.toString() === studentId);
    if (student) {
        student.progress.quizzesCompleted += 1;
        const newAvg = (student.progress.averageScore + quizScore) / 2;
        student.progress.averageScore = Math.round(newAvg);
        student.progress.lastActive = new Date();
        await this.save();
    }
};

const Class = mongoose.model('Class', classSchema);
export default Class;