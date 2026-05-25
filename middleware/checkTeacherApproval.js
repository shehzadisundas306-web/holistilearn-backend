// backend/middleware/checkTeacherApproval.js

import TeacherProfile from '../models/TeacherProfile.js';

export const checkTeacherApproval = async (req, res, next) => {
    try {
        const userId = req.userId;
        const userRole = req.user?.role;
        
        // Only check for teachers
        if (userRole !== 'teacher') {
            return next();
        }
        
        const teacherProfile = await TeacherProfile.findOne({ userId });
        
        // Check if profile exists
        if (!teacherProfile) {
            return res.status(403).json({
                success: false,
                message: 'Please complete your teacher profile first.',
                requiresProfile: true
            });
        }
        
        // Check if approved
        if (!teacherProfile.isApproved) {
            return res.status(403).json({
                success: false,
                message: 'Your teacher account is pending admin approval.',
                pendingApproval: true
            });
        }
        
        next();
    } catch (error) {
        console.error('Teacher approval check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};