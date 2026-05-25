import mongoose from 'mongoose'; // ✅ ADD THIS IMPORT
import Class from '../models/Class.js';
import TeacherProfile from '../models/TeacherProfile.js';
import User from '../models/userModel.js';
import Enrollment from '../models/Enrollment.js'; // ✅ ADD THIS IMPORT

const MAX_STUDENTS_PER_CLASS = 100;

// ==================== HELPER FUNCTIONS ====================

// Helper to safely get student name
const getStudentName = (student) => {
    return student?.name || student?.username || 'Student';
};

// Helper to safely get teacher name
const getTeacherName = (teacher) => {
    return teacher?.name || teacher?.username || 'Teacher';
};

// ==================== STUDENT CLASS MANAGEMENT ====================

// Student join class with code
export const joinClassWithCode = async (req, res) => {
    try {
        const { classCode } = req.body;
        const studentId = req.userId;

        if (!classCode) {
            return res.status(400).json({
                success: false,
                message: 'Class code is required'
            });
        }

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // ✅ Use findOneAndUpdate with atomic operation to prevent race conditions
        const classData = await Class.findOne({ 
            classCode: classCode.toUpperCase(), 
            isActive: true 
        }).populate('teacherId', 'username email name profile.avatar');

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Invalid class code. Please check and try again.'
            });
        }

        // ✅ Check class capacity
        const currentStudentCount = classData.students?.length || 0;
        if (currentStudentCount >= MAX_STUDENTS_PER_CLASS) {
            return res.status(400).json({
                success: false,
                message: 'This class has reached its maximum capacity'
            });
        }

        // ✅ Check if already enrolled (using string comparison for safety)
        const alreadyEnrolled = classData.students?.some(
            s => s && s.studentId && s.studentId.toString() === studentId.toString()
        );

        if (alreadyEnrolled) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this class'
            });
        }

        // ✅ Prevent teacher from joining own class
        if (classData.teacherId && classData.teacherId._id.toString() === studentId.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Teachers cannot join their own classes'
            });
        }

        // ✅ Use atomic update to add student (prevents race conditions)
        const updatedClass = await Class.findOneAndUpdate(
            { 
                _id: classData._id,
                'students.studentId': { $ne: studentId } // Ensure not already enrolled
            },
            {
                $push: {
                    students: { 
                        studentId, 
                        joinedAt: new Date(),
                        progress: {
                            quizzesCompleted: 0,
                            averageScore: 0,
                            lastActive: new Date()
                        }
                    }
                }
            },
            { new: true }
        );

        if (!updatedClass) {
            // This means the student was added between our check and the update
            return res.status(400).json({
                success: false,
                message: 'Unable to join class. You may already be enrolled.'
            });
        }

        // ✅ Create/update enrollment record
        await Enrollment.findOneAndUpdate(
            { studentId, classId: classData._id },
            { 
                status: 'active', 
                joinedAt: new Date(),
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true, new: true }
        );

        // ✅ Update teacher's total students count (using aggregation for accuracy)
        const uniqueStudentCount = await Class.aggregate([
            { $match: { teacherId: classData.teacherId._id, isActive: true } },
            { $unwind: { path: '$students', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$students.studentId' } },
            { $count: 'total' }
        ]);
        
        await TeacherProfile.findOneAndUpdate(
            { userId: classData.teacherId._id },
            { $set: { totalStudents: uniqueStudentCount[0]?.total || 0 } }
        );

        // Get student info for notification
        const student = await User.findById(studentId).select('username name profile.avatar');

        // Emit socket event for real-time update to teacher
        if (req.io) {
            req.io.to(`teacher:${classData.teacherId._id}`).emit('class:student-joined', {
                classId: classData._id,
                className: classData.className,
                classCode: classData.classCode,
                student: {
                    id: studentId,
                    name: getStudentName(student),
                    avatar: student?.profile?.avatar || null,
                    joinedAt: new Date()
                },
                totalStudents: updatedClass.students?.length || 0
            });
        }

        return res.status(200).json({
            success: true,
            message: `Successfully joined ${classData.className}!`,
            class: {
                id: classData._id,
                className: classData.className,
                subject: classData.subject,
                topic: classData.topic,
                description: classData.description,
                classCode: classData.classCode,
                teacher: {
                    id: classData.teacherId._id,
                    name: getTeacherName(classData.teacherId),
                    avatar: classData.teacherId.profile?.avatar || null
                },
                joinedAt: new Date()
            }
        });
    } catch (error) {
        console.error('Join class error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again.'
        });
    }
};

// Get student's enrolled classes - ✅ FIXED null checks
export const getStudentClasses = async (req, res) => {
    try {
        const studentId = req.userId;

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        const classes = await Class.find({ 
            'students.studentId': studentId,
            isActive: true 
        })
        .populate('teacherId', 'username email name profile.avatar')
        .sort({ createdAt: -1 });

        const formattedClasses = classes.map(cls => {
            // ✅ Safe find with null check
            const studentData = cls.students?.find(s => 
                s && s.studentId && s.studentId.toString() === studentId.toString()
            );
            
            // ✅ Safe teacher data with fallbacks
            const teacher = cls.teacherId || {};
            
            return {
                id: cls._id,
                className: cls.className || 'Unnamed Class',
                subject: cls.subject || 'General',
                topic: cls.topic || '',
                classCode: cls.classCode || '',
                description: cls.description || '',
                teacher: {
                    id: teacher._id,
                    name: getTeacherName(teacher),
                    avatar: teacher.profile?.avatar || null
                },
                joinedAt: studentData?.joinedAt || null,
                progress: studentData?.progress || {
                    quizzesCompleted: 0,
                    averageScore: 0
                },
                totalStudents: (cls.students || []).filter(s => s && s.studentId).length,
                createdAt: cls.createdAt
            };
        });

        return res.status(200).json({
            success: true,
            classes: formattedClasses,
            total: formattedClasses.length
        });
    } catch (error) {
        console.error('Get student classes error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


// backend/controllers/studentController.js

export const getStudentClassDetails = async (req, res) => {
    try {
        const { classId } = req.params;
        const studentId = req.userId;

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        const classData = await Class.findOne({ 
            _id: classId,
            'students.studentId': studentId,
            isActive: true 
        })
        .populate('teacherId', 'username email name profile.avatar bio')
        .populate('students.studentId', 'username email name profile.avatar isOnline lastSeen');

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or you are not enrolled'
            });
        }

        // ✅ Filter out invalid students
        const validStudents = (classData.students || []).filter(s => 
            s && s.studentId && s.studentId._id
        );

        if (validStudents.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No valid student data found for this class'
            });
        }

        // ✅ Find current student's enrolled data
        const studentEnrollment = validStudents.find(
            s => s.studentId._id.toString() === studentId.toString()
        );

        if (!studentEnrollment) {
            return res.status(404).json({
                success: false,
                message: 'Student enrollment not found'
            });
        }

        // ✅ Calculate actual quiz progress for this student in this class
        const Quiz = mongoose.model('Quiz');
        const QuizHistory = mongoose.model('QuizHistory');
        
        // Get all quizzes for this class
        const classQuizzes = await Quiz.find({ 
            classId: classId,
            isActive: true,
            isPublished: true
        }).select('_id title');

        // Get student's quiz history
        const quizHistory = await QuizHistory.findOne({ studentId });
        
        let quizzesCompleted = 0;
        let totalScore = 0;
        let quizScores = [];

        // Calculate progress only for quizzes from this class
        if (quizHistory && quizHistory.attempts) {
            classQuizzes.forEach(quiz => {
                const attempt = quizHistory.attempts.find(
                    a => a.quizId && a.quizId.toString() === quiz._id.toString()
                );
                if (attempt) {
                    quizzesCompleted++;
                    totalScore += attempt.score || 0;
                    quizScores.push(attempt.score || 0);
                }
            });
        }

        const averageScore = quizzesCompleted > 0 ? totalScore / quizzesCompleted : 0;
        
        // ✅ Get unique classmates (excluding current user)
        const seenIds = new Set();
        const uniqueClassmates = [];

        validStudents.forEach(s => {
            const classmateId = s.studentId._id.toString();
            if (classmateId !== studentId.toString() && !seenIds.has(classmateId)) {
                seenIds.add(classmateId);
                uniqueClassmates.push({
                    id: s.studentId._id,
                    name: s.studentId.name || s.studentId.username || 'Unknown Student',
                    avatar: s.studentId.profile?.avatar || null,
                    isOnline: s.studentId.isOnline || false,
                    joinedAt: s.joinedAt || null
                });
            }
        });

        // ✅ Safe teacher data
        const teacher = classData.teacherId || {};
        const teacherData = {
            id: teacher._id || null,
            name: teacher.name || teacher.username || 'Teacher',
            avatar: teacher.profile?.avatar || null,
            bio: teacher.bio || '',
            isOnline: teacher.isOnline || false
        };

        return res.status(200).json({
            success: true,
            class: {
                id: classData._id,
                className: classData.className || 'Untitled Class',
                subject: classData.subject || 'General',
                topic: classData.topic || '',
                description: classData.description || '',
                classCode: classData.classCode || '',
                teacher: teacherData,
                myProgress: {
                    quizzesCompleted: quizzesCompleted,
                    averageScore: Math.round(averageScore),
                    lastActive: studentEnrollment.lastActive || new Date(),
                    joinedAt: studentEnrollment.joinedAt || classData.createdAt
                },
                classmates: uniqueClassmates,
                totalStudents: validStudents.length,
                settings: classData.settings || {},
                createdAt: classData.createdAt
            }
        });
        
    } catch (error) {
        console.error('Get class details error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Leave class - ✅ FIXED atomic operation
export const leaveClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const studentId = req.userId;

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (!classId) {
            return res.status(400).json({
                success: false,
                message: 'Class ID is required'
            });
        }

        // ✅ Use atomic operation to remove student
        const classData = await Class.findOneAndUpdate(
            { 
                _id: classId,
                'students.studentId': studentId
            },
            {
                $pull: { students: { studentId: studentId } }
            },
            { new: true }
        );

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or you are not enrolled'
            });
        }

        // Update enrollment status
        await Enrollment.findOneAndUpdate(
            { studentId, classId: classData._id },
            { status: 'inactive', leftAt: new Date() }
        );

        // Update teacher's total students count
        const uniqueStudentCount = await Class.aggregate([
            { $match: { teacherId: classData.teacherId, isActive: true } },
            { $unwind: { path: '$students', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$students.studentId' } },
            { $count: 'total' }
        ]);
        
        await TeacherProfile.findOneAndUpdate(
            { userId: classData.teacherId },
            { $set: { totalStudents: uniqueStudentCount[0]?.total || 0 } }
        );

        // Emit socket event to teacher
        if (req.io) {
            req.io.to(`teacher:${classData.teacherId}`).emit('class:student-left', {
                classId: classData._id,
                className: classData.className,
                studentId,
                totalStudents: classData.students?.length || 0
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Successfully left the class'
        });
    } catch (error) {
        console.error('Leave class error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ✅ Optional: Get class roster (for students to see classmates)
export const getClassRoster = async (req, res) => {
    try {
        const { classId } = req.params;
        const studentId = req.userId;

        // Verify student is enrolled
        const classData = await Class.findOne({
            _id: classId,
            'students.studentId': studentId,
            isActive: true
        }).populate('students.studentId', 'username name profile.avatar isOnline');

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or you are not enrolled'
            });
        }

        const classmates = (classData.students || [])
            .filter(s => s && s.studentId && s.studentId._id.toString() !== studentId.toString())
            .map(s => ({
                id: s.studentId._id,
                name: s.studentId.name || s.studentId.username || 'Student',
                avatar: s.studentId.profile?.avatar || null,
                isOnline: s.studentId.isOnline || false,
                joinedAt: s.joinedAt
            }));

        return res.status(200).json({
            success: true,
            roster: {
                totalStudents: (classData.students || []).filter(s => s && s.studentId).length,
                classmates
            }
        });
    } catch (error) {
        console.error('Get class roster error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};