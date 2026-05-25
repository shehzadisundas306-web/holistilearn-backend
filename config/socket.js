// backend/config/socket.js
import jwt from 'jsonwebtoken';
import StudentProgress from '../models/StudentProgress.js';
import QuizHistory from '../models/QuizHistory.js';
import Activity from '../models/Activity.js';
import ChatRoom from '../models/ChatRoom.js';
import User from '../models/userModel.js';
import NotificationService from '../services/notificationService.js';

const userSockets = new Map();
const socketUsers = new Map();

export const initializeProgressSocket = (io) => {
  
  // Auth middleware - FIXED: Use correct JWT secret variable
  io.use((socket, next) => {
    try {
      let token = socket.handshake.auth.token;
      
      if (!token && socket.handshake.headers.authorization) {
        token = socket.handshake.headers.authorization.split(' ')[1];
      }
      
      if (!token && socket.handshake.query.token) {
        token = socket.handshake.query.token;
      }
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        // FIXED: Use SECRET_KEY (not JWT_SECRET) to match your auth controller
        const secret = process.env.SECRET_KEY || process.env.JWT_SECRET;
        const decoded = jwt.verify(token, secret);
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
      } catch (jwtError) {
        console.error('❌ JWT Verification Error:', jwtError.message);
        
        if (jwtError.message === 'invalid signature') {
          return next(new Error('Invalid token signature - Please login again'));
        }
        if (jwtError.message === 'jwt expired') {
          return next(new Error('Token expired - Please login again'));
        }
        return next(new Error(`Authentication failed: ${jwtError.message}`));
      }
    } catch (error) {
      console.error('❌ Socket auth error:', error.message);
      next(new Error(`Authentication failed: ${error.message}`));
    }
  });

  io.on('connection', (socket) => {
    
    userSockets.set(socket.userId, socket.id);
    socketUsers.set(socket.id, socket.userId);
    
    // Join user-specific rooms for notifications and direct messages
    socket.join(`user:${socket.userId}`);
    socket.join(`progress:${socket.userId}`);
    
    // Join role-specific rooms (for role-based broadcasts)
    if (socket.userRole) {
      socket.join(`role:${socket.userRole}`);
    }
    
    // Join teacher room if user is teacher
    if (socket.userRole === 'teacher') {
      socket.join(`teacher:${socket.userId}`);
      socket.join('teacher:all'); // Common room for all teachers
    }
    
    // Join student room if user is student
    if (socket.userRole === 'student') {
      socket.join(`student:${socket.userId}`);
    }
    
    // Join admin room if user is admin
    if (socket.userRole === 'admin') {
      socket.join(`admin:${socket.userId}`);
      socket.join('admin:all');
    }
    
    // Update user online status in database
    User.findByIdAndUpdate(socket.userId, { 
      isOnline: true, 
      lastSeen: new Date() 
    }).catch(err => console.error('Error updating online status:', err));
    
    socket.emit('connected', { 
      message: 'Connected to real-time service',
      role: socket.userRole,
      userId: socket.userId,
      timestamp: new Date()
    });

    // ==================== PROGRESS EVENTS ====================
    socket.on('join-progress-room', () => {
      socket.join(`progress:${socket.userId}`);
      socket.emit('progress-room-joined', { success: true });
    });

    socket.on('leave-progress-room', () => {
      socket.leave(`progress:${socket.userId}`);
    });

    socket.on('request-progress-update', async () => {

      await emitProgressUpdate(io, socket.userId);
    });

    // ==================== CLASS ROOM EVENTS ====================
    
    // Join teacher's class rooms
    socket.on('join-class-room', ({ classId }) => {
      if (classId) {
        socket.join(`class:${classId}`);
        socket.emit('class-room-joined', { classId, success: true });
      }
    });
    
    socket.on('leave-class-room', ({ classId }) => {
      if (classId) {
        socket.leave(`class:${classId}`);
      }
    });
    
    // Request class stats (for teachers)
    socket.on('teacher:request-class-stats', async ({ classId }) => {
      try {
        const Class = await import('../models/Class.js').then(m => m.default);
        const classData = await Class.findOne({ _id: classId, teacherId: socket.userId })
          .populate('students.studentId', 'username name email profile.avatar isOnline');
        
        if (classData && socket.userRole === 'teacher') {
          const validStudents = (classData.students || []).filter(s => s && s.studentId);
          
          socket.emit('teacher:class-stats', {
            classId,
            className: classData.className,
            studentCount: validStudents.length,
            students: validStudents.map(s => ({
              id: s.studentId._id,
              name: s.studentId.name || s.studentId.username,
              email: s.studentId.email,
              avatar: s.studentId.profile?.avatar,
              isOnline: userSockets.has(s.studentId._id.toString()) || s.studentId.isOnline || false,
              joinedAt: s.joinedAt
            })),
            onlineStudents: validStudents.filter(s => userSockets.has(s.studentId._id.toString())).length,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error fetching class stats:', error);
        socket.emit('error', { message: 'Failed to fetch class stats' });
      }
    });
    
    // Request teacher dashboard stats
    socket.on('teacher:request-stats', async () => {
      try {
        const Class = await import('../models/Class.js').then(m => m.default);
        const classes = await Class.find({ teacherId: socket.userId, isActive: true });
        const totalStudents = classes.reduce((sum, cls) => sum + (cls.students?.length || 0), 0);
        
        socket.emit('teacher:stats', {
          totalClasses: classes.length,
          totalStudents,
          activeClasses: classes.filter(c => c.isActive).length,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Error fetching teacher stats:', error);
      }
    });

    // ==================== CHAT EVENTS ====================
    
    // Join user's personal room for direct messages
    socket.on('join-user-room', () => {
      socket.join(`user:${socket.userId}`);
      socket.emit('user-room-joined', { success: true });
    });
    
    // Join a specific chat room
    socket.on('join-chat', ({ chatId }) => {
      if (chatId) {
        socket.join(`chat:${chatId}`);
        socket.emit('chat-joined', { chatId, success: true });
      }
    });
    
    // Leave a chat room
    socket.on('leave-chat', ({ chatId }) => {
      if (chatId) {
        socket.leave(`chat:${chatId}`);
      }
    });
    
    // Send a message (real-time)
    socket.on('message:send', async ({ chatId, text, recipientId, tempId }) => {
      try {
        const sender = await User.findById(socket.userId).select('name username role');
        const senderName = sender?.name || sender?.username || 'User';
        const isTeacher = sender?.role === 'teacher';
        
        const messageData = {
          id: Date.now().toString(),
          text: text.trim(),
          senderId: socket.userId,
          senderName,
          senderRole: sender?.role,
          timestamp: new Date(),
          isRead: false
        };
        
        // Optionally save to database (your sendMessage controller will handle persistence)
        
        // Emit to chat room for all participants
        io.to(`chat:${chatId}`).emit('message:new', {
          chatId,
          message: messageData,
          tempId
        });
        
        // Notify recipient individually with enhanced notification
        if (recipientId) {
          // Simple notification
          io.to(`user:${recipientId}`).emit('new-message', {
            chatId,
            message: messageData
          });
          
          // Enhanced notification with more details
          io.to(`user:${recipientId}`).emit('new-message-notification', {
            type: 'message',
            title: isTeacher ? '👨‍🏫 Teacher Message' : '💬 New Message',
            message: `${senderName}: ${text.trim().substring(0, 80)}${text.length > 80 ? '...' : ''}`,
            link: isTeacher ? `/teacher/dashboard/messages/${chatId}` : `/student/chat/${chatId}`,
            icon: '💬',
            color: '#3b82f6',
            priority: 'high',
            chatId: chatId,
            from: socket.userId,
            fromName: senderName,
            fromRole: sender?.role,
            isTeacher: isTeacher,
            messagePreview: text.trim().substring(0, 100),
            timestamp: messageData.timestamp
          });
        }
        
        socket.emit('message:sent', { messageId: messageData.id, tempId });
        
      } catch (error) {
        console.error('Error sending message via socket:', error);
        socket.emit('message:error', { error: 'Failed to send message', tempId });
      }
    });
    
    // Typing indicators
    socket.on('typing', ({ chatId, recipientId, isTyping }) => {
      const userRole = socket.userRole === 'teacher' ? 'teacher' : 'student';
      const userName = socket.userRole === 'teacher' ? 'Teacher' : 'Student';
      
      if (recipientId) {
        socket.to(`user:${recipientId}`).emit('user:typing', {
          chatId,
          userId: socket.userId,
          userName,
          userRole,
          isTyping
        });
      }
      
      if (chatId) {
        socket.to(`chat:${chatId}`).emit('user:typing', {
          chatId,
          userId: socket.userId,
          userName,
          userRole,
          isTyping
        });
      }
    });
    
    // Mark messages as read
    socket.on('messages:read', async ({ chatId, messageIds }) => {
      try {
        const ChatRoomModel = await import('../models/ChatRoom.js').then(m => m.default);
        const chat = await ChatRoomModel.findOne({ _id: chatId, participants: socket.userId });
        
        if (chat) {
          let updatedSenders = new Set();
          
          chat.messages.forEach(msg => {
            if (msg.senderId.toString() !== socket.userId && !msg.readBy?.includes(socket.userId)) {
              if (!msg.readBy) msg.readBy = [];
              msg.readBy.push(socket.userId);
              updatedSenders.add(msg.senderId.toString());
            }
          });
          
          if (updatedSenders.size > 0) {
            await chat.save();
            
            // Emit read receipts to each sender
            updatedSenders.forEach(senderId => {
              io.to(`user:${senderId}`).emit('message:read-receipt', {
                chatId: chat._id,
                readBy: socket.userId,
                readAt: new Date(),
                messageIds: messageIds || []
              });
            });
          }
          
          // Reset unread count for current user
          if (chat.unreadCount) {
            chat.unreadCount.set(socket.userId.toString(), 0);
            await chat.save();
          }
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });
    
    // Mark single message as read
    socket.on('message:read', async ({ messageId, chatId, senderId }) => {
      if (senderId) {
        io.to(`user:${senderId}`).emit('message:read-receipt', {
          messageId,
          chatId,
          readBy: socket.userId,
          readAt: new Date()
        });
      }
      
      io.to(`chat:${chatId}`).emit('message:read-receipt', {
        messageId,
        chatId,
        readBy: socket.userId,
        readAt: new Date()
      });
    });

    // ==================== QUIZ EVENTS ====================
    
    // Quiz assigned to student (teacher to student)
    socket.on('quiz:assigned', ({ studentId, quizData }) => {
      io.to(`user:${studentId}`).emit('quiz:new-assignment', {
        ...quizData,
        assignedAt: new Date()
      });
      
      // Also send notification
      io.to(`user:${studentId}`).emit('new-quiz-notification', {
        type: 'quiz_assigned',
        title: '📝 New Quiz Assigned!',
        message: `New quiz "${quizData.title}" has been assigned to you`,
        link: `/student/quiz/${quizData.quizId}`,
        icon: '📝',
        color: '#10b981',
        quizId: quizData.quizId,
        quizTitle: quizData.title,
        dueDate: quizData.dueDate
      });
    });
    
    // Student submitted quiz (notify teacher)
    socket.on('quiz:submitted', ({ teacherId, quizId, quizTitle, studentName, score, percentage }) => {
      io.to(`teacher:${teacherId}`).emit('quiz:submitted-notification', {
        quizId,
        quizTitle,
        studentName,
        score,
        percentage,
        timestamp: new Date()
      });
      
      // Send enhanced notification
      io.to(`teacher:${teacherId}`).emit('new-quiz-submission', {
        type: 'quiz_submitted',
        title: '📊 Quiz Submitted!',
        message: `${studentName} submitted "${quizTitle}" with ${percentage}%`,
        link: `/teacher/dashboard/quiz/${quizId}?mode=results`,
        icon: '📊',
        color: '#10b981',
        quizId,
        quizTitle,
        studentName,
        score: percentage
      });
    });

    // ==================== NOTIFICATION EVENTS ====================
    
    // Mark notification as read
    socket.on('notification:read', async ({ notificationId }) => {
      try {
        const Notification = await import('../models/Notification.js').then(m => m.default);
        await Notification.findOneAndUpdate(
          { _id: notificationId, userId: socket.userId },
          { read: true, readAt: new Date() }
        );
        
        const unreadCount = await Notification.countDocuments({ userId: socket.userId, read: false });
        io.to(`user:${socket.userId}`).emit('notification-count-update', { count: unreadCount });
        
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    });
    
    // Mark all notifications as read
    socket.on('notifications:read-all', async () => {
      try {
        const Notification = await import('../models/Notification.js').then(m => m.default);
        await Notification.updateMany(
          { userId: socket.userId, read: false },
          { read: true, readAt: new Date() }
        );
        
        io.to(`user:${socket.userId}`).emit('notification-count-update', { count: 0 });
        
      } catch (error) {
        console.error('Error marking all notifications as read:', error);
      }
    });
    
    // Request unread count
    socket.on('notification:request-count', async () => {
      try {
        const Notification = await import('../models/Notification.js').then(m => m.default);
        const unreadCount = await Notification.countDocuments({ userId: socket.userId, read: false });
        io.to(`user:${socket.userId}`).emit('notification-count-update', { count: unreadCount });
      } catch (error) {
        console.error('Error fetching unread count:', error);
      }
    });

    // ==================== ONLINE STATUS ====================
    
    // Update online status (broadcast to relevant rooms)
    socket.on('update-status', async ({ isOnline }) => {
      try {
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline, 
          lastSeen: new Date() 
        });
        
        const statusData = { 
          userId: socket.userId, 
          userName: socket.userRole === 'teacher' ? 'Teacher' : 'Student',
          userRole: socket.userRole,
          isOnline, 
          lastSeen: new Date() 
        };
        
        // Notify all rooms this user is in (chats, classes)
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
          if (room.startsWith('chat:') || room.startsWith('class:')) {
            socket.to(room).emit('user:status-change', statusData);
          }
        });
        
        // Also broadcast to role rooms
        io.to(`role:${socket.userRole}`).emit('user:status-change', statusData);
        
      } catch (error) {
        console.error('Error updating status:', error);
      }
    });

    // ==================== CLASS EVENTS (Student Side) ====================
    
    // Student joining class via code (real-time notification to teacher)
    socket.on('class:join', async ({ classCode, className, teacherId, studentName }) => {
      if (teacherId) {
        io.to(`teacher:${teacherId}`).emit('class:student-joined', {
          classCode,
          className,
          studentId: socket.userId,
          studentName,
          joinedAt: new Date()
        });
        
        // Send notification to teacher
        io.to(`teacher:${teacherId}`).emit('new-student-notification', {
          type: 'student_joined',
          title: '👋 New Student Joined!',
          message: `${studentName} joined your class "${className}"`,
          link: `/teacher/dashboard/classes`,
          icon: '👨‍🎓',
          color: '#10b981',
          classId: classCode,
          className,
          studentName
        });
      }
    });

    // ==================== DISCONNECT ====================
    socket.on('disconnect', async () => {
      
      // Update user's online status to false
      try {
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline: false, 
          lastSeen: new Date() 
        });
        
        // Broadcast offline status
        const statusData = { 
          userId: socket.userId, 
          isOnline: false, 
          lastSeen: new Date() 
        };
        
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
          if (room.startsWith('chat:') || room.startsWith('class:')) {
            socket.to(room).emit('user:status-change', statusData);
          }
        });
        
      } catch (error) {
        console.error('Error updating offline status:', error);
      }
      
      userSockets.delete(socket.userId);
      socketUsers.delete(socket.id);
    });
  });
};

// Helper function to safely get study time
const getTodayStudyTime = (progress) => {
  try {
    if (typeof progress.getTodayStudyTime === 'function') {
      return progress.getTodayStudyTime();
    }
    const today = new Date().toDateString();
    const weekData = progress.weeklyActivity?.[progress.weeklyActivity?.length - 1];
    if (weekData?.days) {
      const todayEntry = weekData.days.find(day => 
        new Date(day.date).toDateString() === today
      );
      return todayEntry?.studyTime || 0;
    }
    return 0;
  } catch (error) {
    console.error('Error getting today study time:', error);
    return 0;
  }
};

const getWeeklyStudyTime = (progress) => {
  try {
    if (typeof progress.getWeeklyStudyTime === 'function') {
      return progress.getWeeklyStudyTime();
    }
    const weekData = progress.weeklyActivity?.[progress.weeklyActivity?.length - 1];
    return weekData?.totalStudyTime || 0;
  } catch (error) {
    console.error('Error getting weekly study time:', error);
    return 0;
  }
};

// Emit full progress update
export const emitProgressUpdate = async (io, userId) => {
  try {
    const [progress, quizHistory, activity] = await Promise.all([
      StudentProgress.findOne({ studentId: userId }),
      QuizHistory.findOne({ studentId: userId }),
      Activity.findOne({ studentId: userId })
    ]);

    if (!progress) {
      io.to(`user:${userId}`).to(`progress:${userId}`).emit('progress-update', {
        type: 'initial',
        data: null,
        timestamp: new Date()
      });
      return;
    }

    const completedTopics = progress.topicsProgress?.filter(t => t.status === 'completed') || [];
    const inProgressTopics = progress.topicsProgress?.filter(t => t.status === 'in_progress') || [];
    
    const todayStudyTime = getTodayStudyTime(progress);
    const weeklyStudyTime = getWeeklyStudyTime(progress);
    
    const xpForCurrentLevel = (progress.stats.level - 1) * 100;
    const xpForNextLevel = progress.stats.level * 100;
    const xpInCurrentLevel = progress.stats.xpPoints - xpForCurrentLevel;
    const xpNeededForNextLevel = xpForNextLevel - xpForCurrentLevel;
    const progressToNextLevel = xpNeededForNextLevel > 0 
      ? (xpInCurrentLevel / xpNeededForNextLevel) * 100 
      : 0;

    let recentActivities = [];
    if (activity && activity.activities) {
      recentActivities = activity.activities.slice(-10).map(a => ({
        id: a._id,
        type: a.type,
        title: a.title,
        description: a.description,
        timestamp: a.timestamp,
        icon: a.icon || getIconForActivity(a.type),
        metadata: a.metadata
      }));
    }

    const weakTopics = quizHistory?.statistics?.weakTopics || [];
    const topicsMastered = quizHistory?.statistics?.topicsMastered || [];

    const progressData = {
      stats: {
        completedLessons: progress.stats.completedLessons || 0,
        quizzesTaken: progress.stats.quizzesTaken || 0,
        averageScore: progress.stats.averageScore || 0,
        learningStreak: progress.stats.learningStreak || 0,
        xpPoints: progress.stats.xpPoints || 0,
        level: progress.stats.level || 1,
        totalStudyTime: progress.stats.totalStudyTime || 0,
        totalTopics: progress.topicsProgress?.length || 0,
        completedTopics: completedTopics.length,
        inProgressTopics: inProgressTopics.length,
        todayStudyTime,
        weeklyStudyTime,
        xpToNextLevel: Math.max(0, Math.ceil(xpNeededForNextLevel - xpInCurrentLevel)),
        progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel))
      },
      recentActivity: recentActivities,
      inProgress: inProgressTopics.slice(0, 5),
      achievements: progress.achievements?.slice(-5) || [],
      quizStats: {
        totalQuizzes: quizHistory?.statistics?.totalQuizzes || 0,
        averageScore: quizHistory?.statistics?.averageScore || 0,
        weakTopics: weakTopics.slice(0, 4),
        topicsMastered: topicsMastered.slice(0, 4)
      },
      lastUpdated: new Date()
    };

    io.to(`user:${userId}`).to(`progress:${userId}`).emit('progress-update', {
      type: 'full_update',
      data: progressData,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Error emitting progress update:', error);
    io.to(`user:${userId}`).emit('progress-error', {
      message: 'Failed to fetch progress data',
      error: error.message
    });
  }
};

// Emit incremental update
export const emitIncrementalUpdate = async (io, userId, updateType, updateData) => {
  io.to(`user:${userId}`).to(`progress:${userId}`).emit('progress-incremental', {
    type: updateType,
    data: updateData,
    timestamp: new Date()
  });
};

// Trigger progress update from controllers
export const triggerProgressUpdate = async (io, userId, updateType = 'full', additionalData = {}) => {
  if (!io) {
    console.error('IO instance not available');
    return;
  }
  
  if (updateType === 'full') {
    await emitProgressUpdate(io, userId);
  } else {
    await emitIncrementalUpdate(io, userId, updateType, additionalData);
  }
};

// Get user socket ID
export const getUserSocketId = (userId) => {
  return userSockets.get(userId);
};

// Check if user is online
export const isUserOnline = (userId) => {
  return userSockets.has(userId);
};

// Get all online users
export const getOnlineUsers = () => {
  return Array.from(userSockets.keys());
};

// Send notification to a specific user
export const sendNotificationToUser = (io, userId, event, data) => {
  io.to(`user:${userId}`).emit(event, data);
};

// Send notification to all teachers
export const notifyAllTeachers = (io, event, data) => {
  io.to('teacher:all').emit(event, data);
};

// Send notification to all admins
export const notifyAllAdmins = (io, event, data) => {
  io.to('admin:all').emit(event, data);
};

// Broadcast to all users in a class
export const notifyClass = (io, classId, event, data) => {
  io.to(`class:${classId}`).emit(event, data);
};

const getIconForActivity = (type) => {
  const icons = {
    'quiz_completed': '📝',
    'topic_completed': '✅',
    'topic_started': '🚀',
    'level_up': '🎉',
    'achievement_earned': '🏆',
    'notes_generated': '📓',
    'quiz_generated': '❓'
  };
  return icons[type] || '📌';
};

export default { 
  initializeProgressSocket, 
  emitProgressUpdate, 
  emitIncrementalUpdate, 
  triggerProgressUpdate,
  getUserSocketId,
  isUserOnline,
  getOnlineUsers,
  sendNotificationToUser,
  notifyAllTeachers,
  notifyAllAdmins,
  notifyClass
};