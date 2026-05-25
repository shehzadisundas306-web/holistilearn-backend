// backend/controllers/adminController.js
import User from '../models/userModel.js';
import Class from '../models/Class.js';
import Quiz from '../models/Quiz.js';
import TeacherProfile from '../models/TeacherProfile.js';
import QuizHistory from '../models/QuizHistory.js';
import Enrollment from '../models/Enrollment.js';
import Activity from '../models/Activity.js';
import mongoose from 'mongoose';
import { Session } from '../models/sessionModel.js';
import AdminLog from '../models/AdminLog.js';
import AssignmentSubmission from '../models/AssignmentSubmission.js';
import ChatRoom from '../models/ChatRoom.js';
import Notification from '../models/Notification.js';

// ==================== DASHBOARD STATISTICS ====================

export const getDashboardStats = async (req, res) => {
    try {
        // User counts
        const totalUsers = await User.countDocuments();
        const totalStudents = await User.countDocuments({ role: 'student' });
        const totalTeachers = await User.countDocuments({ role: 'teacher' });
        const pendingTeachers = await TeacherProfile.countDocuments({ isApproved: false });
        const blockedUsers = await User.countDocuments({ isActive: false });
        
        // Platform activity
        const totalClasses = await Class.countDocuments({ isActive: true });
        const totalQuizzes = await Quiz.countDocuments({ isPublished: true });
        
        // Get total submissions
        const submissionStats = await QuizHistory.aggregate([
            { $unwind: '$attempts' },
            { $group: { _id: null, total: { $sum: 1 } } }
        ]);
        const totalSubmissions = submissionStats[0]?.total || 0;
        
        // Recent activity (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const recentUsers = await User.countDocuments({
            createdAt: { $gte: sevenDaysAgo }
        });
        
        const recentClasses = await Class.countDocuments({
            createdAt: { $gte: sevenDaysAgo }
        });
        
        const recentQuizzes = await Quiz.countDocuments({
            createdAt: { $gte: sevenDaysAgo }
        });
        
        // User growth (last 7 days - daily)
        const userGrowth = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(date.getDate() + 1);
            
            const count = await User.countDocuments({
                createdAt: { $gte: date, $lt: nextDate }
            });
            
            userGrowth.push({
                date: date.toISOString().split('T')[0],
                count
            });
        }
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                totalStudents,
                totalTeachers,
                pendingTeachers,
                blockedUsers,
                totalClasses,
                totalQuizzes,
                totalSubmissions,
                recentUsers,
                recentClasses,
                recentQuizzes
            },
            userGrowth
        });
        
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics'
        });
    }
};

// ==================== USER MANAGEMENT ====================

export const getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20, role, search, status } = req.query;
        
        const query = {};
        
        if (role && role !== 'all') {
            query.role = role;
        }
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (status === 'blocked') {
            query.isActive = false;
        } else if (status === 'active') {
            query.isActive = true;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const users = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await User.countDocuments(query);
        
        res.json({
            success: true,
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users'
        });
    }
};

export const getUserDetails = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId)
            .select('-password')
            .populate('progress', 'stats quizzesCompleted averageScore')
            .populate('mentalState', 'currentState');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Get additional stats
        let quizzesTaken = 0;
        let averageScore = 0;
        
        if (user.role === 'student') {
            const quizHistory = await QuizHistory.findOne({ studentId: userId });
            if (quizHistory) {
                quizzesTaken = quizHistory.attempts?.length || 0;
                averageScore = quizHistory.statistics?.averageScore || 0;
            }
        }
        
        if (user.role === 'teacher') {
            const teacherProfile = await TeacherProfile.findOne({ userId });
            if (teacherProfile) {
                user.teacherProfile = teacherProfile;
            }
        }
        
        res.json({
            success: true,
            user: {
                ...user.toObject(),
                quizzesTaken,
                averageScore
            }
        });
        
    } catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user details'
        });
    }
};

export const updateUserStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { isBlocked, reason } = req.body;
        
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Prevent blocking yourself
        if (userId === req.userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot block yourself'
            });
        }
        
        // Prevent blocking admin accounts
        if (user.role === 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Cannot block admin accounts'
            });
        }
        
        // Update user status
        user.isActive = !isBlocked;
        await user.save();
        
        // ✅ IMPORTANT: Delete user's session to force logout
        await Session.deleteMany({ userId: userId });
        
        // ✅ Also update socket connection if needed
        const io = req.app.locals.io;
        if (io) {
            io.to(`user:${userId}`).emit('account-blocked', {
                isBlocked: !user.isActive,
                message: isBlocked ? 'Your account has been blocked' : 'Your account has been unblocked'
            });
        }
        
        // Create admin log
        await AdminLog.create({
            adminId: req.userId,
            action: isBlocked ? 'block_user' : 'unblock_user',
            targetId: userId,
            targetType: user.role,
            details: { reason, userEmail: user.email, userName: user.name || user.username }
        });
        
        res.json({
            success: true,
            message: isBlocked ? 'User blocked successfully' : 'User unblocked successfully',
            user: {
                _id: user._id,
                isActive: user.isActive
            }
        });
        
    } catch (error) {
        console.error('Update user status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status'
        });
    }
};


export const deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Prevent deleting yourself
        if (userId === req.userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account'
            });
        }
        
        // Prevent deleting admin accounts
        if (user.role === 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete admin accounts'
            });
        }
        
        // Store user info for logging
        const userInfo = {
            id: user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            name: user.name
        };
        
        // Delete all related data
        if (user.role === 'teacher') {
            // Delete teacher profile
            await TeacherProfile.deleteOne({ userId });
            // Delete all classes
            const classes = await Class.find({ teacherId: userId });
            const classIds = classes.map(c => c._id);
            await Class.deleteMany({ teacherId: userId });
            // Delete quizzes
            await Quiz.deleteMany({ createdBy: userId });
            // Delete online sessions
            await OnlineSession.deleteMany({ teacherId: userId });
        }
        
        if (user.role === 'student') {
            // Delete enrollments
            await Enrollment.deleteMany({ studentId: userId });
            // Delete quiz history
            await QuizHistory.deleteOne({ studentId: userId });
            // Delete assignment submissions
            await AssignmentSubmission?.deleteMany({ studentId: userId });
            // Remove from classes
            await Class.updateMany(
                { 'students.studentId': userId },
                { $pull: { students: { studentId: userId } } }
            );
        }
        
        // Delete chat rooms and messages
        await ChatRoom.updateMany(
            { participants: userId },
            { $pull: { participants: userId } }
        );
        await ChatRoom.deleteMany({ participants: { $size: 0 } });
        
        // Delete notifications
        await Notification.deleteMany({ userId });
        
        // Delete sessions
        await Session.deleteMany({ userId });
        
        // ✅ Finally, delete the user - HARD DELETE
        await User.deleteOne({ _id: userId });
        
        // Create admin log (make sure to handle validation)
        try {
            await AdminLog.create({
                adminId: req.userId,
                action: 'delete_user',
                targetId: userId,
                targetType: user.role === 'student' ? 'student' : 'teacher',
                details: {
                    userEmail: user.email,
                    userName: user.name || user.username,
                    deletedAt: new Date(),
                    userInfo
                }
            });
        } catch (logError) {
            console.error('Failed to create admin log:', logError.message);
            // Don't fail the main operation
        }
        
        // Emit socket event to force logout
        const io = req.app.locals.io;
        if (io) {
            io.to(`user:${userId}`).emit('account-deleted', {
                message: 'Your account has been deleted by admin'
            });
        }
        
        res.json({
            success: true,
            message: 'User deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user: ' + error.message
        });
    }
};

export const getPendingTeachers = async (req, res) => {
    try {
        const teachers = await TeacherProfile.find({ isApproved: false })
            .populate('userId', 'name username email profile.avatar createdAt')
            .sort({ createdAt: 1 });
        
        res.json({
            success: true,
            teachers
        });
        
    } catch (error) {
        console.error('Get pending teachers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch pending teachers'
        });
    }
};
// ==================== SYSTEM SETTINGS ====================



// ==================== APPROVE TEACHER ====================

export const approveTeacher = async (req, res) => {
    try {
        const { teacherId } = req.params;

        const teacherProfile = await TeacherProfile.findOne({ userId: teacherId });

        if (!teacherProfile) {
            return res.status(404).json({
                success: false,
                message: 'Teacher profile not found'
            });
        }

        // Approve teacher profile
        teacherProfile.isApproved = true;
        teacherProfile.approvedAt = new Date();
        teacherProfile.rejectionReason = '';
        teacherProfile.rejectedAt = null;
        await teacherProfile.save();

        // Update user
        await User.findByIdAndUpdate(teacherId, {
            role: 'teacher',
            isActive: true
        });

        // Log admin action
        await AdminLog.create({
            adminId: req.userId,
            action: 'approve_teacher',
            targetId: teacherId,
            targetType: 'teacher',
            details: {
                approvedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Teacher approved successfully'
        });

    } catch (error) {
        console.error('Approve teacher error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve teacher'
        });
    }
};


// ==================== REJECT TEACHER ====================

export const rejectTeacher = async (req, res) => {
    try {
        const { teacherId } = req.params;
        const { reason } = req.body;

        const teacherProfile = await TeacherProfile.findOne({ userId: teacherId });

        if (!teacherProfile) {
            return res.status(404).json({
                success: false,
                message: 'Teacher profile not found'
            });
        }

        // Reject teacher profile
        teacherProfile.isApproved = false;
        teacherProfile.rejectionReason = reason || 'Application rejected by admin';
        teacherProfile.rejectedAt = new Date();
        await teacherProfile.save();

        // Optional: deactivate user account
        await User.findByIdAndUpdate(teacherId, {
            isActive: false
        });

        // Log admin action
        await AdminLog.create({
            adminId: req.userId,
            action: 'reject_teacher',
            targetId: teacherId,
            targetType: 'teacher',
            details: {
                reason: reason || 'Application rejected by admin',
                rejectedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Teacher application rejected'
        });

    } catch (error) {
        console.error('Reject teacher error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject teacher'
        });
    }
};

export const getTeacherStats = async (req, res) => {
    try {
        const totalTeachers = await User.countDocuments({ role: 'teacher' });
        const approvedTeachers = await TeacherProfile.countDocuments({ isApproved: true });
        const pendingTeachers = await TeacherProfile.countDocuments({ isApproved: false });
        
        // Teachers with most classes
        const topTeachers = await Class.aggregate([
            { $group: { _id: '$teacherId', classCount: { $sum: 1 } } },
            { $sort: { classCount: -1 } },
            { $limit: 10 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'teacher' } },
            { $unwind: '$teacher' }
        ]);
        
        res.json({
            success: true,
            stats: {
                totalTeachers,
                approvedTeachers,
                pendingTeachers,
                approvalRate: totalTeachers > 0 ? (approvedTeachers / totalTeachers) * 100 : 0
            },
            topTeachers
        });
        
    } catch (error) {
        console.error('Get teacher stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch teacher statistics'
        });
    }
};

// ==================== STUDENT MANAGEMENT ====================

export const getStudentStats = async (req, res) => {
    try {
        const totalStudents = await User.countDocuments({ role: 'student' });
        const activeStudents = await User.countDocuments({ role: 'student', isActive: true });
        
        // Students with most quiz completions
        const topStudents = await QuizHistory.aggregate([
            { $project: { studentId: 1, attemptsCount: { $size: '$attempts' } } },
            { $sort: { attemptsCount: -1 } },
            { $limit: 10 },
            { $lookup: { from: 'users', localField: 'studentId', foreignField: '_id', as: 'student' } },
            { $unwind: '$student' }
        ]);
        
        res.json({
            success: true,
            stats: {
                totalStudents,
                activeStudents,
                inactiveStudents: totalStudents - activeStudents
            },
            topStudents
        });
        
    } catch (error) {
        console.error('Get student stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch student statistics'
        });
    }
};

// ==================== CLASS MANAGEMENT ====================

export const getAllClasses = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        
        const query = { isActive: true };
        
        if (search) {
            query.$or = [
                { className: { $regex: search, $options: 'i' } },
                { subject: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const classes = await Class.find(query)
            .populate('teacherId', 'name username email')
            .populate('students.studentId', 'name username')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Class.countDocuments(query);
        
        const formattedClasses = classes.map(cls => ({
            _id: cls._id,
            className: cls.className,
            subject: cls.subject,
            topic: cls.topic,
            teacher: cls.teacherId,
            studentCount: cls.students?.length || 0,
            createdAt: cls.createdAt,
            isActive: cls.isActive
        }));
        
        res.json({
            success: true,
            classes: formattedClasses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch classes'
        });
    }
};

export const deleteClass = async (req, res) => {
    try {
        const { classId } = req.params;
        
        const classData = await Class.findById(classId);
        
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }
        
        // Soft delete
        classData.isActive = false;
        await classData.save();
        
        // Also delete associated quizzes
        await Quiz.updateMany(
            { classId },
            { isActive: false, isPublished: false }
        );
        
        res.json({
            success: true,
            message: 'Class deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete class error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete class'
        });
    }
};

// ==================== QUIZ MANAGEMENT ====================

export const getAllQuizzes = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        
        const query = { isPublished: true };
        
        if (search) {
            query.title = { $regex: search, $options: 'i' };
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const quizzes = await Quiz.find(query)
            .populate('createdBy', 'name username email')
            .populate('classId', 'className')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Quiz.countDocuments(query);
        
        const formattedQuizzes = quizzes.map(quiz => ({
            _id: quiz._id,
            title: quiz.title,
            topic: quiz.topic,
            difficulty: quiz.difficulty,
            questionCount: quiz.questions?.length || 0,
            submissions: quiz.submissions?.length || 0,
            createdBy: quiz.createdBy,
            class: quiz.classId,
            createdAt: quiz.createdAt,
            isActive: quiz.isActive
        }));
        
        res.json({
            success: true,
            quizzes: formattedQuizzes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get quizzes error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch quizzes'
        });
    }
};

export const deleteQuiz = async (req, res) => {
    try {
        const { quizId } = req.params;
        
        const quiz = await Quiz.findById(quizId);
        
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }
        
        // Soft delete
        quiz.isActive = false;
        quiz.isPublished = false;
        await quiz.save();
        
        res.json({
            success: true,
            message: 'Quiz deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete quiz error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete quiz'
        });
    }
};

// ==================== PLATFORM ANALYTICS ====================

export const getPlatformAnalytics = async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        
        let days = 7;
        if (period === 'month') days = 30;
        if (period === 'year') days = 365;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        // User registrations over time
        const userRegistrations = await User.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                students: { $sum: { $cond: [{ $eq: ['$role', 'student'] }, 1, 0] } },
                teachers: { $sum: { $cond: [{ $eq: ['$role', 'teacher'] }, 1, 0] } }
            } },
            { $sort: { _id: 1 } }
        ]);
        
        // Quiz activity
        const quizActivity = await QuizHistory.aggregate([
            { $unwind: '$attempts' },
            { $match: { 'attempts.completedAt': { $gte: startDate } } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$attempts.completedAt' } },
                count: { $sum: 1 },
                avgScore: { $avg: '$attempts.score' }
            } },
            { $sort: { _id: 1 } }
        ]);
        
        // Class creation trend
        const classCreation = await Class.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 }
            } },
            { $sort: { _id: 1 } }
        ]);
        
        res.json({
            success: true,
            analytics: {
                period,
                userRegistrations,
                quizActivity,
                classCreation
            }
        });
        
    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch analytics'
        });
    }
};

// ==================== SYSTEM SETTINGS ====================

let systemSettings = {
    aiQuizLimit: 10,
    maxClassSize: 100,
    allowTeacherRegistration: true,
    maintenanceMode: false,
    quizTimeLimit: 60,
    maxQuizAttempts: 3
};

export const getSystemSettings = async (req, res) => {
    try {
        // In production, load from database settings collection
        res.json({
            success: true,
            settings: systemSettings
        });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch settings'
        });
    }
};

// ==================== SYSTEM SETTINGS ====================

export const updateSystemSettings = async (req, res) => {
    try {
        const updates = req.body;

        // Merge new settings
        systemSettings = {
            ...systemSettings,
            ...updates
        };

        // Save admin log (only if AdminLog model exists and works)
        try {
            await AdminLog.create({
                adminId: req.userId,
                action: 'update_system_settings',
                targetType: 'system',
                details: updates
            });
        } catch (logError) {
            console.error('AdminLog creation failed:', logError.message);
            // Do not fail the whole request if logging fails
        }

        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: systemSettings
        });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update settings'
        });
    }
};


// ==================== ACTIVITY LOGS ====================

export const getActivityLogs = async (req, res) => {
    try {
        const { page = 1, limit = 50, type } = req.query;
        
        const query = {};
        if (type) query.type = type;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const logs = await Activity.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate('userId', 'name username email');
        
        const total = await Activity.countDocuments(query);
        
        res.json({
            success: true,
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get activity logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch activity logs'
        });
    }
};

// backend/controllers/adminController.js

// ✅ Add this function for admin profile update
export const updateAdminProfile = async (req, res) => {
    try {
        const adminId = req.userId;
        const { name, username, email, currentPassword, newPassword } = req.body;

        // Find admin user
        const admin = await User.findById(adminId).select('+password');
        
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Check if admin role
        if (admin.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access'
            });
        }

        // Update basic info
        if (name) admin.name = name;
        if (username) admin.username = username;
        if (email) admin.email = email;

        // Update password if provided
        if (currentPassword && newPassword) {
            // Verify current password
            const isPasswordValid = await bcrypt.compare(currentPassword, admin.password);
            if (!isPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            admin.password = hashedPassword;
        }

        await admin.save();

        // Remove password from response
        const adminResponse = admin.toObject();
        delete adminResponse.password;

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: adminResponse
        });

    } catch (error) {
        console.error('Update admin profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
};

// backend/controllers/adminController.js

export const getAllTeachersForAdmin = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      isApproved
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // Build teacher profile filter
    const profileFilter = {};

    if (typeof isApproved !== 'undefined') {
      profileFilter.isApproved = isApproved === 'true';
    }

    // Get teacher profiles with populated user data
    const teacherProfiles = await TeacherProfile.find(profileFilter)
      .populate({
        path: 'userId',
        select: 'name username email role isActive createdAt lastLogin',
        match: search
          ? {
              $or: [
                { name: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
              ]
            }
          : {}
      })
      .sort({ createdAt: -1 });

    // Remove profiles where userId is null
    // This happens if the referenced user was deleted
    const validProfiles = teacherProfiles.filter(
      (profile) => profile.userId !== null
    );

    // Pagination after filtering
    const total = validProfiles.length;
    const paginatedProfiles = validProfiles.slice(
      skip,
      skip + Number(limit)
    );

    // Format response
    const teachers = paginatedProfiles.map((profile) => ({
      _id: profile.userId._id,
      name: profile.userId.name,
      username: profile.userId.username,
      email: profile.userId.email,
      role: profile.userId.role,
      isActive: profile.userId.isActive,
      createdAt: profile.userId.createdAt,
      lastLogin: profile.userId.lastLogin,

      // Approval fields
      isApproved: profile.isApproved,
      approvedAt: profile.approvedAt,
      rejectedAt: profile.rejectedAt,
      rejectionReason: profile.rejectionReason,

      // Profile fields
      degree: profile.degree,
      specialization: profile.specialization,
      experience: profile.experience,
      bio: profile.bio,
      subjects: profile.subjects,
      totalStudents: profile.totalStudents || 0,
      totalClasses: profile.totalClasses || 0,

      // Nested profile for modal
      teacherProfile: {
        degree: profile.degree,
        specialization: profile.specialization,
        experience: profile.experience,
        bio: profile.bio,
        subjects: profile.subjects
      }
    }));

    return res.status(200).json({
      success: true,
      teachers,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Get all teachers error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teachers'
    });
  }
};