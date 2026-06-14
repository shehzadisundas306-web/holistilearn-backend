// backend/server.js - COMPLETE VERSION with Teacher Dashboard Support
import express from 'express';
import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './database/db.js';
import userRoute from './routes/userRoute.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import './config/passport.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import mentalStateRoutes from './routes/mentalStateRoutes.js';
import topicRoutes from './routes/topicRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import quizRoutes from './routes/quizRoutes.js';
import progressRoutes from './routes/progressRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import learningPathRoutes from './routes/learningPathRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import onlineClassRoutes from './routes/onlineClassRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import User from './models/userModel.js';
import jwt from 'jsonwebtoken';
import uploadRoutes from './routes/uploadRoutes.js';
import assignmentRoutes from './routes/assignmentRoutes.js';
// Import socket initialization
import { initializeProgressSocket, triggerProgressUpdate, emitProgressUpdate, isUserOnline } from './config/socket.js';
import TeacherProfile from './models/TeacherProfile.js';
import Class from './models/Class.js';
import { startSessionAutoEndCron } from './utils/cronJobs.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

const allowedOrigins = [
    "http://localhost:3000",
    "https://holistilearn-frontend.vercel.app"
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(passport.initialize());

// Mount routes
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/user', userRoute);
app.use('/api', dashboardRoutes);
app.use('/api/mental-state', mentalStateRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/learning-path', learningPathRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/online-class', onlineClassRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);


app.use('/api/assignments', assignmentRoutes);
// Mount upload routes
app.use('/api/upload', uploadRoutes);

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.io with CORS config
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST']
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// ==================== SOCKET AUTHENTICATION MIDDLEWARE ====================
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    
    if (!decoded || !decoded.id) {
      return next(new Error('Authentication error: Invalid token'));
    }
    
    // Get user from database
    const user = await User.findById(decoded.id).select('_id role name username isActive');
    
    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }
    
    // Check if user is active
    if (!user.isActive) {
      return next(new Error('Authentication error: Account blocked'));
    }
    
    // Attach user info to socket
    socket.userId = user._id.toString();
    socket.userRole = user.role;
    socket.userName = user.name || user.username;
    next();
    
  } catch (error) {
    console.error('❌ Socket authentication error:', error.message);
    next(new Error(`Authentication error: ${error.message}`));
  }
});


app.locals.io = io;
app.set('io', io);


export { io };

// ==================== SOCKET CONNECTION HANDLER ====================
io.on('connection', (socket) => {
  
  // ==================== USER ROOM JOINING ====================
  // Join user-specific room for direct notifications
  socket.join(`user:${socket.userId}`);
  
  // Join role-specific room
  if (socket.userRole === 'teacher') {
    socket.join(`role:teacher`);
    socket.join(`teacher:${socket.userId}`);
    
    // Send initial teacher stats
    socket.emit('teacher:connected', {
      message: 'Connected to teacher dashboard',
      userId: socket.userId,
      timestamp: new Date()
    });
  }
  
  if (socket.userRole === 'student') {
    socket.join(`role:student`);
    socket.join(`student:${socket.userId}`);
    
    // Send initial student data
    socket.emit('student:connected', {
      message: 'Connected to student dashboard',
      userId: socket.userId,
      timestamp: new Date()
    });
  }
  
  if (socket.userRole === 'admin') {
    socket.join(`role:admin`);
    socket.join(`admin:${socket.userId}`);
  }
  
  // ==================== NOTIFICATION ROOMS ====================
  
  // Handle joining class room
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
  
  // Handle joining chat room
  socket.on('join-chat', ({ chatId }) => {
    if (chatId) {
      socket.join(`chat:${chatId}`);
      socket.emit('chat-joined', { chatId, success: true });
    }
  });
  
  socket.on('leave-chat', ({ chatId }) => {
    if (chatId) {
      socket.leave(`chat:${chatId}`);
    }
  });
  
  // ==================== TEACHER EVENTS ====================
  
  // Handle teacher requesting class stats
  socket.on('teacher:request-class-stats', async ({ classId }) => {
    try {
      const classData = await Class.findById(classId)
        .populate('students.studentId', 'username email name profile.avatar isOnline lastSeen');
      
      if (classData && classData.teacherId.toString() === socket.userId) {
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
            isOnline: s.studentId.isOnline || false,
            joinedAt: s.joinedAt
          })),
          onlineStudents: validStudents.filter(s => s.studentId?.isOnline).length,
          timestamp: new Date()
        });
      } else {
        socket.emit('error', { message: 'Unauthorized or class not found' });
      }
    } catch (error) {
      console.error('Error fetching class stats:', error);
      socket.emit('error', { message: 'Failed to fetch class stats' });
    }
  });
  
  // Handle teacher requesting dashboard stats
  socket.on('teacher:request-stats', async () => {
    try {
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
  
  // Handle sending messages
  socket.on('message:send', async ({ chatId, text, recipientId, tempId }) => {
    try {
      const ChatRoom = (await import('./models/ChatRoom.js')).default;
      const chat = await ChatRoom.findOne({ _id: chatId, participants: socket.userId });
      
      if (!chat) {
        socket.emit('message:error', { error: 'Chat not found', tempId });
        return;
      }
      
      const messageData = {
        id: Date.now().toString(),
        chatId,
        senderId: socket.userId,
        senderName: socket.userName,
        text: text.trim(),
        createdAt: new Date(),
        isRead: false
      };
      
      // Save message (implementation depends on your schema)
      chat.messages = chat.messages || [];
      chat.messages.push({
        _id: messageData.id,
        text: messageData.text,
        senderId: socket.userId,
        senderName: socket.userName,
        createdAt: messageData.createdAt,
        readBy: [socket.userId]
      });
      
      chat.lastMessage = {
        text: messageData.text,
        senderId: socket.userId,
        senderName: socket.userName,
        createdAt: messageData.createdAt
      };
      
      // Update unread count for other participants
      chat.participants.forEach(participantId => {
        if (participantId.toString() !== socket.userId) {
          const currentUnread = chat.unreadCount?.get(participantId.toString()) || 0;
          chat.unreadCount.set(participantId.toString(), currentUnread + 1);
        }
      });
      
      await chat.save();
      
      // Emit to chat room
      io.to(`chat:${chatId}`).emit('message:new', {
        chatId,
        message: messageData,
        tempId
      });
      
      // Emit notification to recipient
      const otherParticipants = chat.participants.filter(p => p.toString() !== socket.userId);
      for (const participantId of otherParticipants) {
        io.to(`user:${participantId}`).emit('new-message-notification', {
          chatId,
          messageId: messageData.id,
          from: socket.userId,
          fromName: socket.userName,
          messagePreview: text.trim().substring(0, 100),
          timestamp: messageData.createdAt
        });
      }
      
      socket.emit('message:sent', { messageId: messageData.id, tempId });
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message:error', { error: 'Failed to send message', tempId });
    }
  });
  
  // Handle typing indicator
  socket.on('typing', ({ chatId, recipientId, isTyping }) => {
    if (chatId) {
      socket.to(`chat:${chatId}`).emit('user:typing', {
        chatId,
        userId: socket.userId,
        userName: socket.userName,
        userRole: socket.userRole,
        isTyping
      });
    }
    
    if (recipientId) {
      socket.to(`user:${recipientId}`).emit('user:typing', {
        userId: socket.userId,
        userName: socket.userName,
        userRole: socket.userRole,
        isTyping
      });
    }
  });
  
  // Handle mark messages as read
  socket.on('messages:read', async ({ chatId }) => {
    try {
      const ChatRoom = (await import('./models/ChatRoom.js')).default;
      const chat = await ChatRoom.findOne({ _id: chatId, participants: socket.userId });
      
      if (chat) {
        let updated = false;
        chat.messages.forEach(msg => {
          if (msg.senderId.toString() !== socket.userId && !msg.readBy?.includes(socket.userId)) {
            if (!msg.readBy) msg.readBy = [];
            msg.readBy.push(socket.userId);
            updated = true;
          }
        });
        
        if (updated) {
          await chat.save();
          
          // Emit read receipts to senders
          const unreadMessages = chat.messages.filter(msg => 
            msg.senderId.toString() !== socket.userId && msg.readBy?.includes(socket.userId)
          );
          
          unreadMessages.forEach(msg => {
            io.to(`user:${msg.senderId}`).emit('message:read-receipt', {
              messageId: msg._id,
              chatId: chat._id,
              readBy: socket.userId,
              readAt: new Date()
            });
          });
        }
        
        // Reset unread count
        if (chat.unreadCount) {
          chat.unreadCount.set(socket.userId.toString(), 0);
          await chat.save();
        }
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });
  
  // ==================== PROGRESS EVENTS ====================
  
  // Join progress room for real-time updates
  socket.on('join-progress-room', () => {
    if (socket.userRole === 'student') {
      socket.join(`progress:${socket.userId}`);
      socket.emit('progress-room-joined', { success: true });
    }
  });
  
  socket.on('leave-progress-room', () => {
    if (socket.userRole === 'student') {
      socket.leave(`progress:${socket.userId}`);
    }
  });
  
  // Request progress update
  socket.on('request-progress-update', async () => {
    if (socket.userRole === 'student') {
      try {
        const StudentProgress = (await import('./models/StudentProgress.js')).default;
        const progress = await StudentProgress.findOne({ studentId: socket.userId });
        
        if (progress) {
          socket.emit('progress-update', {
            type: 'full_update',
            data: {
              level: progress.stats?.level,
              xpPoints: progress.stats?.xpPoints,
              quizzesTaken: progress.stats?.quizzesTaken,
              averageScore: progress.stats?.averageScore,
              streak: progress.streak
            },
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error fetching progress:', error);
      }
    }
  });
  
  // ==================== CLASS JOIN EVENTS ====================
  
  // Handle student joining class (real-time notification to teacher)
  socket.on('class:join', async ({ classCode }) => {
    try {
      const classData = await Class.findOne({ classCode, isActive: true });
      if (classData && classData.teacherId) {
        io.to(`teacher:${classData.teacherId}`).emit('class:student-joined', {
          classId: classData._id,
          className: classData.className,
          studentId: socket.userId,
          studentName: socket.userName,
          joinedAt: new Date()
        });
      }
    } catch (error) {
      console.error('Error processing class join:', error);
    }
  });
  
  // ==================== NOTIFICATION ACKNOWLEDGMENT ====================
  
  socket.on('notification:read', async ({ notificationId }) => {
    try {
      const Notification = (await import('./models/Notification.js')).default;
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
  
  // ==================== DISCONNECTION ====================
  
  socket.on('disconnect', () => {
    
    // Update user's online status
    if (socket.userId) {
      User.findByIdAndUpdate(socket.userId, { 
        isOnline: false, 
        lastSeen: new Date() 
      }).catch(err => console.error('Error updating user status:', err));
    }
  });
});

// Initialize progress socket with authentication
initializeProgressSocket(io);

// Add helper middleware for controllers
app.use((req, res, next) => {
  req.io = io;
  req.triggerProgressUpdate = triggerProgressUpdate;
  req.emitProgressUpdate = emitProgressUpdate;
  req.isUserOnline = isUserOnline;
  next();
});

// ==================== START CRON JOBS ====================
try {
  startSessionAutoEndCron(io);
  console.log('✅ Session auto-end cron job started');
} catch (cronError) {
  console.error('❌ Failed to start cron job:', cronError);
}

// ==================== GRACEFUL SHUTDOWN ====================

const gracefulShutdown = async () => {
  
  if (io) {
    io.close(() => {
      console.log('📡 Socket.io server closed');
    });
  }
  
  httpServer.close(() => {
    process.exit(0);
  });
  
  setTimeout(() => {
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ==================== START SERVER ====================

const startServer = async () => {
  try {
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    process.exit(1);
  }
};

startServer();