import TeacherProfile from '../models/TeacherProfile.js';
import Class from '../models/Class.js';
import User from '../models/userModel.js';
import NotificationService from '../services/notificationService.js'; // ✅ ADD THIS

// ==================== PROFILE MANAGEMENT ====================

// backend/controllers/teacherController.js

// Create or update teacher profile
export const upsertTeacherProfile = async (req, res) => {
    try {
        const { degree, specialization, experience, bio, name, phone, location, website } = req.body;
        const userId = req.userId;

        // Validate required fields for profile creation
        if (!degree || !specialization || !experience || !bio) {
            return res.status(400).json({
                success: false,
                message: 'Degree, specialization, experience, and bio are required for teacher profile'
            });
        }

        let profile = await TeacherProfile.findOne({ userId });

        if (profile) {
            // Update existing profile
            profile.degree = degree;
            profile.specialization = specialization;
            profile.experience = experience;
            profile.bio = bio;
            profile.isProfileComplete = true;
            
            // Update optional fields
            if (name) profile.name = name;
            if (phone) profile.phone = phone;
            if (location) profile.location = location;
            if (website) profile.website = website;
            
            await profile.save();

            // Also update user's name if provided
            if (name) {
                await User.findByIdAndUpdate(userId, { name });
            }

            return res.status(200).json({
                success: true,
                message: 'Profile updated successfully',
                profile
            });
        } else {
            // Create new profile
            profile = await TeacherProfile.create({
                userId,
                degree,
                specialization,
                experience,
                bio,
                name: name || '',
                phone: phone || '',
                location: location || '',
                website: website || '',
                isProfileComplete: true,
                isApproved: false // Needs admin approval
            });

            // Update user role to teacher
            await User.findByIdAndUpdate(userId, { role: 'teacher' });

            return res.status(201).json({
                success: true,
                message: 'Profile created successfully. Waiting for admin approval.',
                profile
            });
        }
    } catch (error) {
        console.error('Profile creation/update error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Get teacher profile
export const getTeacherProfile = async (req, res) => {
    try {
        const userId = req.userId;
        
        const profile = await TeacherProfile.findOne({ userId })
            .populate('userId', 'username email name profile.avatar isOnline lastSeen');

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found. Please complete your profile.'
            });
        }

        return res.status(200).json({
            success: true,
            profile
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// backend/controllers/teacherController.js

// Update profile picture - Using multer
export const updateProfilePicture = async (req, res) => {
    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded. Please select an image file.'
            });
        }

        const userId = req.userId;
        
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid file type. Please upload JPEG, PNG, GIF, or WEBP image.'
            });
        }
        
        // Construct file URL
        const fileUrl = `/uploads/profile-pictures/${req.file.filename}`;
        
        // Update teacher profile
        const profile = await TeacherProfile.findOne({ userId });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Teacher profile not found. Please complete your profile first.'
            });
        }

        profile.profilePicture = fileUrl;
        await profile.save();

        // Also update user's profile picture
        await User.findByIdAndUpdate(userId, {
            'profile.avatar': fileUrl
        });

        return res.status(200).json({
            success: true,
            message: 'Profile picture updated successfully',
            profilePicture: fileUrl
        });
    } catch (error) {
        console.error('Update profile picture error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while updating profile picture',
            error: error.message
        });
    }
};

// Update teacher settings
export const updateTeacherSettings = async (req, res) => {
    try {
        const { settings } = req.body;
        const userId = req.userId;

        const profile = await TeacherProfile.findOne({ userId });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        if (settings) {
            profile.settings = { ...profile.settings, ...settings };
        }
        
        await profile.save();

        return res.status(200).json({
            success: true,
            message: 'Settings updated',
            settings: profile.settings
        });
    } catch (error) {
        console.error('Update settings error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


// Check if profile is complete
export const checkProfileStatus = async (req, res) => {
    try {
        const userId = req.userId;
        const profile = await TeacherProfile.findOne({ userId });
        
        return res.status(200).json({
            success: true,
            isComplete: profile?.isProfileComplete || false,
            hasProfile: !!profile,
            isApproved: profile?.isApproved || false
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Update subjects and topics
export const updateSubjectsAndTopics = async (req, res) => {
    try {
        const { subjects, topics } = req.body;
        const userId = req.userId;

        const profile = await TeacherProfile.findOne({ userId });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        if (subjects) profile.subjects = subjects;
        if (topics) profile.topics = topics;
        
        await profile.save();

        return res.status(200).json({
            success: true,
            message: 'Subjects and topics updated',
            subjects: profile.subjects,
            topics: profile.topics
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


// Get teacher by ID (for student view)
export const getTeacherById = async (req, res) => {
    try {
        const { teacherId } = req.params;
        
        const profile = await TeacherProfile.findOne({ userId: teacherId })
            .populate('userId', 'username email name profile.avatar isOnline lastSeen');

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Teacher not found'
            });
        }

        if (profile.settings?.profileVisibility === 'private' && req.userId !== teacherId) {
            return res.status(403).json({
                success: false,
                message: 'This teacher\'s profile is private'
            });
        }

        return res.status(200).json({
            success: true,
            teacher: {
                id: profile.userId._id,
                name: profile.userId.name || profile.userId.username,
                email: profile.userId.email,
                avatar: profile.userId.profile?.avatar,
                degree: profile.degree,
                specialization: profile.specialization,
                experience: profile.experience,
                bio: profile.bio,
                subjects: profile.subjects || [],
                ratings: profile.ratings || { average: 0, count: 0 },
                isOnline: profile.userId.isOnline || false,
                lastSeen: profile.userId.lastSeen
            }
        });
    } catch (error) {
        console.error('Get teacher by ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get all teachers (for discovery)
export const getAllTeachers = async (req, res) => {
    try {
        const { page = 1, limit = 20, subject, search } = req.query;
        
        let query = { isProfileComplete: true, isApproved: true, 'settings.profileVisibility': 'public' };
        
        if (subject) {
            query.subjects = subject;
        }
        
        if (search) {
            const users = await User.find({ 
                $or: [
                    { username: { $regex: search, $options: 'i' } },
                    { name: { $regex: search, $options: 'i' } }
                ],
                role: 'teacher'
            }).select('_id');
            
            const userIds = users.map(u => u._id);
            query.userId = { $in: userIds };
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const teachers = await TeacherProfile.find(query)
            .populate('userId', 'username email name profile.avatar isOnline lastSeen')
            .sort({ 'ratings.average': -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await TeacherProfile.countDocuments(query);
        
        const formattedTeachers = teachers.map(teacher => ({
            id: teacher.userId?._id,
            name: teacher.userId?.name || teacher.userId?.username || 'Unknown Teacher',
            avatar: teacher.userId?.profile?.avatar || null,
            degree: teacher.degree,
            specialization: teacher.specialization,
            experience: teacher.experience,
            subjects: teacher.subjects || [],
            ratings: teacher.ratings || { average: 0, count: 0 },
            isOnline: teacher.userId?.isOnline || false,
            totalStudents: teacher.totalStudents || 0
        }));
        
        return res.status(200).json({
            success: true,
            teachers: formattedTeachers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get all teachers error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ==================== CLASS MANAGEMENT ====================

// Create new class
export const createClass = async (req, res) => {
    try {
        const { className, subject, topic, description } = req.body;
        const teacherId = req.userId;
        const io = req.app.locals.io;

        if (!className || !subject || !topic) {
            return res.status(400).json({
                success: false,
                message: 'Class name, subject, and topic are required'
            });
        }

        const generateClassCode = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            return code;
        };

        let classCode;
        let isUnique = false;
        
        while (!isUnique) {
            classCode = generateClassCode();
            const existingClass = await Class.findOne({ classCode });
            if (!existingClass) isUnique = true;
        }

        const newClass = await Class.create({
            teacherId,
            className,
            subject,
            topic,
            description,
            classCode
        });

        await TeacherProfile.findOneAndUpdate(
            { userId: teacherId },
            { $inc: { totalClasses: 1 } }
        );

        // ✅ Get teacher info for notification
        const teacher = await User.findById(teacherId).select('name username');
        const teacherName = teacher?.name || teacher?.username || 'Teacher';

        // ✅ Notify all admins about new class
        const notificationService = new NotificationService(io);
        
        await notificationService.sendToRole('admin', {
            type: 'class_updated',
            title: '📚 New Class Created',
            message: `${teacherName} created a new class: "${className}"`,
            link: `/admin/classes/${newClass._id}`,
            icon: '📚',
            color: '#10b981',
            priority: 'medium',
            data: {
                classId: newClass._id,
                className: className,
                subject: subject,
                teacherId: teacherId,
                teacherName: teacherName,
                classCode: classCode
            }
        });

        if (io) {
            io.to(`teacher:${teacherId}`).emit('class:created', {
                classId: newClass._id,
                className: newClass.className,
                classCode: newClass.classCode
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Class created successfully',
            class: newClass
        });
    } catch (error) {
        console.error('Create class error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Get all classes for a teacher
export const getTeacherClasses = async (req, res) => {
    try {
        const teacherId = req.userId;
        
        const classes = await Class.find({ teacherId, isActive: true })
            .sort({ createdAt: -1 })
            .populate('students.studentId', 'username email name profile.avatar isOnline lastSeen');

        const formattedClasses = classes.map(cls => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId);
            
            return {
                id: cls._id,
                className: cls.className || 'Unnamed Class',
                subject: cls.subject || 'General',
                topic: cls.topic || '',
                classCode: cls.classCode,
                description: cls.description || '',
                studentCount: validStudents.length,
                students: validStudents.map(s => ({
                    id: s.studentId?._id,
                    name: s.studentId?.name || s.studentId?.username || 'Unknown',
                    email: s.studentId?.email || '',
                    avatar: s.studentId?.profile?.avatar || null,
                    isOnline: s.studentId?.isOnline || false,
                    joinedAt: s.joinedAt || null
                })),
                createdAt: cls.createdAt,
                updatedAt: cls.updatedAt,
                settings: cls.settings || {}
            };
        });

        return res.status(200).json({
            success: true,
            classes: formattedClasses
        });
    } catch (error) {
        console.error('Get classes error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get single class details
export const getClassDetails = async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.userId;

        const classData = await Class.findOne({ _id: classId, teacherId })
            .populate('students.studentId', 'username email name profile.avatar isOnline lastSeen profile.bio');

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        const sanitizedClass = classData.toObject();
        if (sanitizedClass.students) {
            sanitizedClass.students = sanitizedClass.students.filter(s => s && s.studentId);
        }

        return res.status(200).json({
            success: true,
            class: sanitizedClass
        });
    } catch (error) {
        console.error('Get class details error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Delete class
export const deleteClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.userId;
        const io = req.app.locals.io;

        const classData = await Class.findOne({ _id: classId, teacherId });
        
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        // ✅ Notify all students before deletion
        const notificationService = new NotificationService(io);
        
        if (classData.students && classData.students.length > 0) {
            const studentIds = classData.students
                .filter(s => s && s.studentId)
                .map(s => s.studentId);
            
            if (studentIds.length > 0) {
                await notificationService.sendToMultipleUsers(studentIds, {
                    type: 'system',
                    title: '❌ Class Removed',
                    message: `Your class "${classData.className}" has been removed by the teacher`,
                    link: '/student/dashboard',
                    icon: '❌',
                    color: '#ef4444',
                    priority: 'high',
                    data: {
                        classId: classId,
                        className: classData.className
                    }
                });
            }
        }

        await Class.findByIdAndUpdate(classId, { isActive: false });

        await TeacherProfile.findOneAndUpdate(
            { userId: teacherId },
            { $inc: { totalClasses: -1 } }
        );

        if (io) {
            io.to(`teacher:${teacherId}`).emit('class:deleted', {
                classId: classId,
                className: classData.className
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Class deleted successfully'
        });
    } catch (error) {
        console.error('Delete class error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

export const updateClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.userId;
        const updates = req.body;
        const io = req.app.locals.io;

        const classData = await Class.findOne({ _id: classId, teacherId });
        
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        const oldClassName = classData.className;
        const newClassName = updates.className || oldClassName;
        
        // ✅ Handle class code regeneration
        if (updates.regenerateCode) {
            const generateClassCode = () => {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
                let code = '';
                for (let i = 0; i < 6; i++) {
                    code += chars[Math.floor(Math.random() * chars.length)];
                }
                return code;
            };
            
            let newCode;
            let isUnique = false;
            
            while (!isUnique) {
                newCode = generateClassCode();
                const existingClass = await Class.findOne({ classCode: newCode });
                if (!existingClass) isUnique = true;
            }
            
            updates.classCode = newCode;
        }

        const updatedClass = await Class.findOneAndUpdate(
            { _id: classId, teacherId },
            updates,
            { new: true, runValidators: true }
        );

        // ✅ Notify students about class update
        if (io && (newClassName !== oldClassName || updates.regenerateCode)) {
            const notificationService = new NotificationService(io);
            const studentIds = classData.students
                .filter(s => s && s.studentId)
                .map(s => s.studentId);
            
            if (studentIds.length > 0) {
                const message = updates.regenerateCode 
                    ? `The access code for "${updatedClass.className}" has been changed`
                    : `Class "${oldClassName}" has been renamed to "${newClassName}"`;
                
                await notificationService.sendToMultipleUsers(studentIds, {
                    type: 'class_updated',
                    title: updates.regenerateCode ? '🔑 Class Code Updated' : '📋 Class Updated',
                    message: message,
                    link: `/student/classes/${classId}`,
                    icon: updates.regenerateCode ? '🔑' : '📋',
                    color: updates.regenerateCode ? '#f59e0b' : '#3b82f6',
                    priority: 'medium',
                    data: {
                        classId: classId,
                        className: updatedClass.className,
                        newClassCode: updates.classCode
                    }
                });
            }
        }

        if (io) {
            io.to(`teacher:${teacherId}`).emit('class:updated', {
                classId: classId,
                className: updatedClass.className,
                classCode: updatedClass.classCode  // ✅ Include code in response
            });
        }

        return res.status(200).json({
            success: true,
            message: updates.regenerateCode ? 'Class code regenerated successfully' : 'Class updated successfully',
            class: updatedClass
        });
    } catch (error) {
        console.error('Update class error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Regenerate class code
export const regenerateClassCode = async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.userId;
        const io = req.app.locals.io;

        const generateClassCode = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            return code;
        };

        let newCode;
        let isUnique = false;
        
        while (!isUnique) {
            newCode = generateClassCode();
            const existingClass = await Class.findOne({ classCode: newCode });
            if (!existingClass) isUnique = true;
        }

        const classData = await Class.findOneAndUpdate(
            { _id: classId, teacherId },
            { classCode: newCode },
            { new: true }
        );

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        // ✅ Notify students about new class code
        if (io && classData.students && classData.students.length > 0) {
            const notificationService = new NotificationService(io);
            const studentIds = classData.students
                .filter(s => s && s.studentId)
                .map(s => s.studentId);
            
            if (studentIds.length > 0) {
                await notificationService.sendToMultipleUsers(studentIds, {
                    type: 'class_updated',
                    title: '🔑 Class Code Updated',
                    message: `The access code for "${classData.className}" has been changed`,
                    link: `/student/classes/${classId}`,
                    icon: '🔑',
                    color: '#f59e0b',
                    priority: 'medium',
                    data: {
                        classId: classId,
                        className: classData.className,
                        newClassCode: newCode
                    }
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Class code regenerated',
            classCode: newCode
        });
    } catch (error) {
        console.error('Regenerate code error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ==================== DASHBOARD & ANALYTICS ====================

// Get teacher dashboard overview
export const getTeacherOverview = async (req, res) => {
    try {
        const teacherId = req.userId;

        const profile = await TeacherProfile.findOne({ userId: teacherId });
        const classes = await Class.find({ teacherId, isActive: true });
        
        const totalStudents = classes.reduce((sum, cls) => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId);
            return sum + validStudents.length;
        }, 0);
        
        const recentActivities = [
            { id: 1, action: 'Welcome to Teacher Dashboard', time: 'Just now', icon: '👋' }
        ];

        const upcomingTasks = [
            { id: 1, task: 'Complete your profile setup', deadline: 'Today', priority: 'high' }
        ];

        return res.status(200).json({
            success: true,
            data: {
                totalClasses: classes.length,
                totalStudents,
                totalQuizzes: 0,
                averageScore: 0,
                recentActivities,
                upcomingTasks,
                profileComplete: profile?.isProfileComplete || false,
                isApproved: profile?.isApproved || false
            }
        });
    } catch (error) {
        console.error('Overview error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Get teacher analytics
export const getTeacherAnalytics = async (req, res) => {
    try {
        const teacherId = req.userId;
        
        const classes = await Class.find({ teacherId, isActive: true });
        
        const totalStudents = classes.reduce((sum, cls) => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId);
            return sum + validStudents.length;
        }, 0);
        
        const averageClassSize = classes.length > 0 ? totalStudents / classes.length : 0;
        
        // Subject breakdown
        const subjectBreakdown = {};
        classes.forEach(cls => {
            if (cls.subject) {
                if (!subjectBreakdown[cls.subject]) {
                    subjectBreakdown[cls.subject] = { count: 0, students: 0 };
                }
                subjectBreakdown[cls.subject].count++;
                const validStudents = (cls.students || []).filter(s => s && s.studentId);
                subjectBreakdown[cls.subject].students += validStudents.length;
            }
        });
        
        // Class growth over last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const classGrowth = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const classesCreated = classes.filter(cls => 
                cls.createdAt && new Date(cls.createdAt).toDateString() === date.toDateString()
            ).length;
            
            classGrowth.push({
                date: date.toISOString().split('T')[0],
                count: classesCreated
            });
        }

        return res.status(200).json({
            success: true,
            analytics: {
                totalClasses: classes.length,
                totalStudents,
                averageClassSize: Math.round(averageClassSize),
                subjectBreakdown,
                classGrowth
            }
        });
    } catch (error) {
        console.error('Get analytics error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        }); 
    }
};

// ==================== APPROVAL STATUS (FOR TEACHER VIEW) ====================

// Check approval status
export const getApprovalStatus = async (req, res) => {
    try {
        const userId = req.userId;
        const profile = await TeacherProfile.findOne({ userId });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }
        
        return res.status(200).json({
            success: true,
            isApproved: profile.isApproved,
            isProfileComplete: profile.isProfileComplete,
            approvedAt: profile.approvedAt,
            rejectionReason: profile.rejectionReason
        });
    } catch (error) {
        console.error('Get approval status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

