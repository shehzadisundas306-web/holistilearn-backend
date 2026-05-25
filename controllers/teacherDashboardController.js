import TeacherProfile from '../models/TeacherProfile.js';
import Class from '../models/Class.js';
import Quiz from '../models/Quiz.js';
import User from '../models/userModel.js';

// ==================== DASHBOARD STATISTICS ====================
function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return new Date(date).toLocaleDateString();
}

// Get complete teacher dashboard data
export const getTeacherDashboardData = async (req, res) => {
    try {
        const teacherId = req.userId;

        // Get teacher profile
        const profile = await TeacherProfile.findOne({ userId: teacherId });

        // Get all active classes
        const classes = await Class.find({ teacherId, isActive: true })
            .populate('students.studentId', 'username name profile.avatar');

        // ✅ FIXED: Use createdBy instead of teacherId
        const quizzes = await Quiz.find({ createdBy: teacherId });

        // Calculate statistics with null checks
        const totalStudents = classes.reduce((sum, cls) => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId);
            return sum + validStudents.length;
        }, 0);
        
        const totalQuizzes = quizzes.length;

        // Calculate average quiz score across all submissions
        let totalQuizScore = 0;
        let totalSubmissions = 0;
        quizzes.forEach(quiz => {
            if (quiz.submissions && Array.isArray(quiz.submissions)) {
                quiz.submissions.forEach(sub => {
                    if (sub && sub.percentage) {
                        totalQuizScore += sub.percentage;
                        totalSubmissions++;
                    }
                });
            }
        });
        const averageQuizScore = totalSubmissions > 0 ? Math.round(totalQuizScore / totalSubmissions) : 0;

        // Get recent activity (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentActivity = [];

        // New students in last 7 days - ✅ FIXED null checks
        classes.forEach(cls => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId && s.studentId._id);
            const newStudents = validStudents.filter(s => s.joinedAt && new Date(s.joinedAt) >= sevenDaysAgo);
            
            newStudents.forEach(student => {
                recentActivity.push({
                    id: `${cls._id}_${student.studentId._id}`,
                    type: 'student_joined',
                    action: `${student.studentId.name || student.studentId.username || 'Student'} joined ${cls.className || 'Class'}`,
                    time: student.joinedAt,
                    icon: '👨‍🎓',
                    classId: cls._id,
                    className: cls.className
                });
            });
        });

        // Recent quiz submissions - ✅ FIXED null checks
        quizzes.forEach(quiz => {
            if (quiz.submissions && Array.isArray(quiz.submissions)) {
                const recentSubmissions = quiz.submissions.filter(s => 
                    s && s.submittedAt && new Date(s.submittedAt) >= sevenDaysAgo
                );
                recentSubmissions.forEach(sub => {
                    recentActivity.push({
                        id: `${quiz._id}_${sub.studentId}`,
                        type: 'quiz_submitted',
                        action: `Quiz "${quiz.title || 'Untitled'}" submitted`,
                        time: sub.submittedAt,
                        score: sub.percentage || 0,
                        icon: '📝',
                        quizId: quiz._id
                    });
                });
            }
        });

        // Sort by time (newest first) and limit to 10
        recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
        const latestActivity = recentActivity.slice(0, 10);

        // Get upcoming tasks
        const upcomingTasks = [];

        if (!profile?.isProfileComplete) {
            upcomingTasks.push({
                id: 'complete_profile',
                task: 'Complete your teacher profile',
                deadline: 'Today',
                priority: 'high',
                link: '/teacher/dashboard/settings'
            });
        }

        // Check for classes with no quizzes
        const classesWithoutQuizzes = classes.filter(cls => {
            const classQuizzes = quizzes.filter(q => q.classId && q.classId.toString() === cls._id.toString());
            return classQuizzes.length === 0;
        });

        if (classesWithoutQuizzes.length > 0) {
            upcomingTasks.push({
                id: 'create_quiz',
                task: `Create quizzes for ${classesWithoutQuizzes.length} class(es)`,
                deadline: 'This week',
                priority: 'medium',
                link: '/teacher/dashboard/quiz'
            });
        }

        // Weekly chart data (last 7 days) - ✅ FIXED null checks
        const weeklyData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);

            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

            // Count new students on this day
            const newStudentsOnDay = classes.reduce((sum, cls) => {
                const validStudents = (cls.students || []).filter(s => s && s.studentId);
                const studentsOnDay = validStudents.filter(s => 
                    s.joinedAt && new Date(s.joinedAt).toDateString() === date.toDateString()
                ).length;
                return sum + studentsOnDay;
            }, 0);

            // Count quiz submissions on this day
            const submissionsOnDay = quizzes.reduce((sum, quiz) => {
                if (!quiz.submissions) return sum;
                const subsOnDay = quiz.submissions.filter(s => 
                    s && s.submittedAt && new Date(s.submittedAt).toDateString() === date.toDateString()
                ).length;
                return sum + subsOnDay;
            }, 0);

            weeklyData.push({
                day: dayName,
                date: date.toISOString().split('T')[0],
                newStudents: newStudentsOnDay,
                quizSubmissions: submissionsOnDay
            });
        }

        // Subject distribution for chart - ✅ FIXED null checks
        const subjectDistribution = {};
        classes.forEach(cls => {
            if (cls.subject) {
                if (!subjectDistribution[cls.subject]) {
                    subjectDistribution[cls.subject] = {
                        count: 0,
                        students: 0
                    };
                }
                subjectDistribution[cls.subject].count++;
                const validStudents = (cls.students || []).filter(s => s && s.studentId);
                subjectDistribution[cls.subject].students += validStudents.length;
            }
        });

        const subjectChartData = Object.entries(subjectDistribution).map(([name, data]) => ({
            name,
            value: data.count,
            students: data.students
        }));

        // Recent classes (last 5) - ✅ FIXED null checks
        const recentClasses = classes.slice(0, 5).map(cls => ({
            id: cls._id,
            name: cls.className || 'Unnamed Class',
            subject: cls.subject || 'General',
            studentCount: (cls.students || []).filter(s => s && s.studentId).length,
            createdAt: cls.createdAt,
            classCode: cls.classCode
        }));

        // Top performing students across all classes - ✅ FIXED null checks
        const studentPerformance = [];
        classes.forEach(cls => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId && s.studentId._id);
            validStudents.forEach(student => {
                if (student.progress && student.progress.averageScore > 0) {
                    studentPerformance.push({
                        studentId: student.studentId._id,
                        name: student.studentId.name || student.studentId.username || 'Unknown',
                        className: cls.className || 'Unknown Class',
                        averageScore: student.progress.averageScore,
                        quizzesCompleted: student.progress.quizzesCompleted || 0
                    });
                }
            });
        });

        studentPerformance.sort((a, b) => b.averageScore - a.averageScore);
        const topStudents = studentPerformance.slice(0, 5);

        return res.status(200).json({
            success: true,
            dashboard: {
                stats: {
                    totalClasses: classes.length,
                    totalStudents,
                    totalQuizzes,
                    averageScore: averageQuizScore,
                    profileComplete: profile?.isProfileComplete || false
                },
                recentActivity: latestActivity.map(a => ({
                    ...a,
                    time: formatTimeAgo(a.time)
                })),
                upcomingTasks,
                charts: {
                    weekly: weeklyData,
                    subjects: subjectChartData
                },
                recentClasses,
                topStudents
            }
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        console.error('Error stack:', error.stack);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get simplified stats for dashboard cards
export const getTeacherStats = async (req, res) => {
    try {
        const teacherId = req.userId;
        
        const classes = await Class.find({ teacherId, isActive: true });
        
        // ✅ FIXED: Use createdBy instead of teacherId
        const quizzes = await Quiz.find({ createdBy: teacherId });
        const profile = await TeacherProfile.findOne({ userId: teacherId });
        
        // ✅ FIXED: Null check for students
        const totalStudents = classes.reduce((sum, cls) => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId);
            return sum + validStudents.length;
        }, 0);
        
        // Calculate growth percentage (compare with last month)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        let newStudentsLastMonth = 0;
        classes.forEach(cls => {
            const validStudents = (cls.students || []).filter(s => s && s.studentId && s.joinedAt);
            const newJoins = validStudents.filter(s => new Date(s.joinedAt) >= thirtyDaysAgo);
            newStudentsLastMonth += newJoins.length;
        });
        
        const previousTotal = totalStudents - newStudentsLastMonth;
        const studentGrowth = previousTotal > 0 ? (newStudentsLastMonth / previousTotal) * 100 : 0;
        
        return res.status(200).json({
            success: true,
            stats: {
                totalClasses: classes.length,
                totalStudents,
                studentGrowth: Math.round(studentGrowth),
                totalQuizzes: quizzes.length,
                averageRating: profile?.ratings?.average || 0,
                totalReviews: profile?.ratings?.count || 0
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// getClassAnalytics is already correct ✅
export const getClassAnalytics = async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.userId;
        
        const classData = await Class.findOne({ _id: classId, teacherId })
            .populate('students.studentId', 'username name profile.avatar');
        
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }
        
        const quizzes = await Quiz.find({ classId, createdBy: teacherId });
        
        let totalQuizScore = 0;
        let totalSubmissions = 0;
        const studentPerformance = [];
        
        const validStudents = classData.students.filter(student => 
            student && student.studentId && student.studentId._id
        );
        
        validStudents.forEach(student => {
            const studentQuizzes = [];
            let studentTotalScore = 0;
            let studentSubmissions = 0;
            const studentId = student.studentId._id.toString();
            
            quizzes.forEach(quiz => {
                const submission = quiz.submissions?.find(
                    s => s && s.studentId && s.studentId.toString() === studentId
                );
                
                if (submission && submission.percentage) {
                    studentQuizzes.push({
                        quizTitle: quiz.title,
                        score: submission.percentage,
                        submittedAt: submission.submittedAt
                    });
                    studentTotalScore += submission.percentage;
                    studentSubmissions++;
                    totalQuizScore += submission.percentage;
                    totalSubmissions++;
                }
            });
            
            studentPerformance.push({
                studentId: student.studentId._id,
                name: student.studentId.name || student.studentId.username || 'Unknown Student',
                avatar: student.studentId.profile?.avatar || null,
                averageScore: studentSubmissions > 0 ? Math.round(studentTotalScore / studentSubmissions) : 0,
                quizzesCompleted: studentSubmissions,
                joinedAt: student.joinedAt || null,
                lastActive: student.progress?.lastActive || null
            });
        });
        
        const classAverage = totalSubmissions > 0 ? Math.round(totalQuizScore / totalSubmissions) : 0;
        studentPerformance.sort((a, b) => b.averageScore - a.averageScore);
        
        const quizAnalytics = quizzes.map(q => ({
            id: q._id,
            title: q.title,
            submissions: q.submissions?.length || 0,
            averageScore: q.submissions && q.submissions.length > 0 
                ? Math.round(q.submissions.reduce((sum, s) => sum + (s.percentage || 0), 0) / q.submissions.length)
                : 0
        }));
        
        return res.status(200).json({
            success: true,
            analytics: {
                className: classData.className,
                subject: classData.subject,
                totalStudents: validStudents.length,
                totalQuizzes: quizzes.length,
                classAverage,
                studentPerformance,
                quizzes: quizAnalytics
            }
        });
        
    } catch (error) {
        console.error('Get class analytics error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};