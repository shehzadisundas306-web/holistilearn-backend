// backend/controllers/onlineClassController.js
import OnlineSession from '../models/OnlineSession.js';
import Class from '../models/Class.js';
import mongoose from 'mongoose';
import User from '../models/userModel.js';


export const createOnlineSession = async (req, res) => {
  try {
    const { classId, title, description, scheduledStart, scheduledEnd } = req.body;
    const teacherId = req.userId;
    const io = req.app.locals.io;

    // ✅ Validate required fields including end time
    if (!classId || !title || !scheduledStart || !scheduledEnd) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID, title, start time, and end time are required' 
      });
    }

    const startDate = new Date(scheduledStart);
    const endDate = new Date(scheduledEnd);
    const now = new Date();

    // ✅ VALIDATION 1: Cannot schedule in the past
    if (startDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule a live class in the past. Please select a future date and time.'
      });
    }

    // ✅ VALIDATION 2: End time must be after start time
    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time'
      });
    }

    // ✅ VALIDATION 3: Duration should be at least 15 minutes
    const durationMs = endDate - startDate;
    const durationMinutes = durationMs / (1000 * 60);
    if (durationMinutes < 15) {
      return res.status(400).json({
        success: false,
        message: 'Session duration must be at least 15 minutes'
      });
    }

    // ✅ VALIDATION 4: Duration should not exceed 8 hours
    if (durationMinutes > 8 * 60) {
      return res.status(400).json({
        success: false,
        message: 'Session duration cannot exceed 8 hours'
      });
    }

    // ✅ VALIDATION 5: Cannot schedule more than 6 months in advance
    const sixMonthsLater = new Date();
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
    if (startDate > sixMonthsLater) {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule a class more than 6 months in advance'
      });
    }

    const classData = await Class.findOne({ _id: classId, teacherId })
      .populate('students.studentId', '_id name username');

    if (!classData) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not own this class' 
      });
    }

    const session = new OnlineSession({
      classId: new mongoose.Types.ObjectId(classId),
      teacherId: new mongoose.Types.ObjectId(teacherId),
      title: title.trim(),
      description: description || '',
      scheduledStart: startDate,
      scheduledEnd: endDate,
      status: 'scheduled',
      useJitsi: true,
      attendance: [],
      activeParticipants: [],
    });

    await session.save();

    // ✅ Get teacher name for notifications
    const teacher = await User.findById(teacherId).select('name username');
    const teacherName = teacher?.name || teacher?.username || 'Teacher';

    // ✅ Emit socket events
    if (io) {
      // Emit to class room
      io.to(`class:${classId}`).emit('new-online-session', session);

      // ✅ Send notifications to all students in the class
      const students = classData.students || [];
      
      for (const student of students) {
        if (student.studentId && student.studentId._id) {
          const studentId = student.studentId._id;
          
          // Format date for display
          const formattedDate = startDate.toLocaleString();
          
          // Emit notification to student
          io.to(`user:${studentId}`).emit('new-session-notification', {
            type: 'live_class',
            title: '📅 New Live Class Scheduled',
            message: `${teacherName} scheduled "${title}" for ${formattedDate}`,
            link: `/student/classes/${classId}`,
            icon: '🎥',
            color: '#f59e0b',
            priority: 'high',
            classId: classId,
            sessionId: session._id,
            sessionTitle: title,
            scheduledStart: scheduledStart,
            scheduledEnd: scheduledEnd,
            teacherName: teacherName
          });
        }
      }
    }

    res.status(201).json({ 
      success: true, 
      message: 'Live class scheduled successfully',
      session 
    });
    
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to schedule live class'
    });
  }
};

export const getSessionsByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const sessions = await OnlineSession.find({ classId }).sort({ scheduledStart: 1 });
    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getSessionById = async (req, res) => {
  try {
    const session = await OnlineSession.findById(req.params.sessionId)
      .populate('activeParticipants.userId', 'name username email');
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    res.json({ success: true, session });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const startSession = async (req, res) => {
  try {
    const session = await OnlineSession.findById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // ✅ Check if teacher already has an active live session
    const activeSession = await OnlineSession.findOne({
      teacherId: req.userId,
      status: 'live',
      _id: { $ne: session._id }
    });

    if (activeSession) {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have an active live session. Please end it before starting another.' 
      });
    }

    const classData = await Class.findById(session.classId);
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const classTeacherId = classData.teacherId.toString();
    const currentUserId = req.userId.toString();

    if (classTeacherId !== currentUserId) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not the teacher of this class. Only the class teacher can start the session.' 
      });
    }

    session.status = 'live';
    await session.save();

    const io = req.app.locals.io;
    
    // ✅ Get teacher info for notification
    const teacher = await User.findById(req.userId).select('name username');
    const teacherName = teacher?.name || teacher?.username || 'Teacher';

    if (io) {
      // Emit to class room
      io.to(`class:${session.classId}`).emit('session-started', session);
      
      // ✅ Get all students for notifications
      const populatedClass = await Class.findById(session.classId).populate('students.studentId', '_id');
      const students = populatedClass?.students || [];
      
      // Send notifications to all students
      for (const student of students) {
        if (student.studentId && student.studentId._id) {
          io.to(`user:${student.studentId._id}`).emit('session-started-notification', {
            type: 'live_class_started',
            title: '🔴 Live Class Started!',
            message: `${teacherName} has started "${session.title}". Join now!`,
            link: `/student/join-live/${session._id}`,
            icon: '🔴',
            color: '#ef4444',
            priority: 'high',
            classId: session.classId,
            sessionId: session._id,
            sessionTitle: session.title,
            teacherName: teacherName
          });
        }
      }
    }

    res.json({ success: true, session });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ✅ NEW: Check if teacher has an active live session
export const checkTeacherActiveSession = async (req, res) => {
  try {
    const teacherId = req.userId;
    
    const activeSession = await OnlineSession.findOne({
      teacherId,
      status: 'live'
    }).populate('classId', 'className');
    
    res.json({
      success: true,
      hasActiveSession: !!activeSession,
      session: activeSession || null
    });
  } catch (error) {
    console.error('Check active session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ✅ NEW: Record participant joining a session
export const joinSessionParticipant = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;
    const userRole = req.user?.role;
    
    const session = await OnlineSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    // Check if session is live
    if (session.status !== 'live') {
      return res.status(403).json({ success: false, message: 'Session is not live' });
    }
    
    // Check if already in active participants
    const alreadyJoined = session.activeParticipants.some(
      p => p.userId?.toString() === userId.toString()
    );
    
    if (!alreadyJoined) {
      await session.addParticipant(userId, userRole === 'teacher' ? 'teacher' : 'student');
      
      // Get user info for emission
      const User = mongoose.model('User');
      const userInfo = await User.findById(userId).select('name username');
      
      // Emit socket event to all participants
      if (req.io) {
        req.io.to(`session:${sessionId}`).emit('participant-joined', {
          userId,
          name: userInfo?.name || userInfo?.username,
          role: userRole === 'teacher' ? 'teacher' : 'student',
          timestamp: new Date()
        });
        
        req.io.to(`session:${sessionId}`).emit('participant-count', {
          count: session.activeParticipants.length + 1
        });
      }
    }
    
    // Fetch updated session with populated participants
    const updatedSession = await OnlineSession.findById(sessionId)
      .populate('activeParticipants.userId', 'name username');
    
    res.json({
      success: true,
      message: 'Joined session',
      participantCount: updatedSession.activeParticipants.length,
      participants: updatedSession.activeParticipants
    });
  } catch (error) {
    console.error('Join participant error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ✅ NEW: Record participant leaving a session
export const leaveSessionParticipant = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;
    const userRole = req.user?.role;
    
    const session = await OnlineSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    await session.removeParticipant(userId);
    
    // Emit socket event
    if (req.io) {
      const User = mongoose.model('User');
      const userInfo = await User.findById(userId).select('name username');
      
      req.io.to(`session:${sessionId}`).emit('participant-left', {
        userId,
        name: userInfo?.name || userInfo?.username,
        timestamp: new Date()
      });
      
      const updatedSession = await OnlineSession.findById(sessionId);
      req.io.to(`session:${sessionId}`).emit('participant-count', {
        count: updatedSession?.activeParticipants?.length || 0
      });
    }
    
    res.json({ success: true, message: 'Left session' });
  } catch (error) {
    console.error('Leave participant error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ✅ NEW: Get all active participants in a session
export const getSessionParticipants = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await OnlineSession.findById(sessionId)
      .populate('activeParticipants.userId', 'name username email');
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const participants = session.activeParticipants.map(p => ({
      userId: p.userId._id,
      name: p.userId.name || p.userId.username,
      role: p.role,
      joinedAt: p.joinedAt
    }));
    
    res.json({
      success: true,
      participants,
      count: participants.length
    });
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// backend/controllers/onlineClassController.js

// ✅ FIXED: Teacher ends the session (kicks everyone)
export const endSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const teacherId = req.user?.id || req.user?._id || req.userId;  // ✅ Try multiple options
    
    if (!teacherId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }
    
    const session = await OnlineSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    // ✅ Verify teacher owns this session
    if (session.teacherId.toString() !== teacherId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    // Check if session is already ended
    if (session.status === 'ended') {
      return res.status(400).json({ success: false, message: 'Session already ended' });
    }
    
    // Use the model method to end the session
    await session.endSession('teacher');
    
    // Emit socket event to ALL participants to kick them out
    if (req.io) {
      req.io.to(`session:${sessionId}`).emit('session-ended', {
        sessionId: session._id,
        title: session.title,
        message: 'Teacher has ended the session',
        timestamp: new Date()
      });
    }
    
    res.json({ success: true, message: 'Session ended successfully' });
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Student/Teacher: Join a session (get meeting info)
export const joinSession = async (req, res) => {
  try {
    const session = await OnlineSession.findById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Check if session is ended
    if (session.status === 'ended') {
      return res.status(403).json({ 
        success: false, 
        message: 'This session has already ended.' 
      });
    }

    // Check enrollment or teacher status
    const classData = await Class.findById(session.classId);
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const currentUserId = req.userId.toString();
    
    const isTeacher = session.teacherId && session.teacherId.toString() === currentUserId;
    const isEnrolled = classData.students && classData.students.some(s => s.studentId?.toString() === currentUserId);

    if (!isTeacher && !isEnrolled) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not authorized to join this session' 
      });
    }

    if (!isTeacher && session.status !== 'live') {
      return res.status(403).json({ 
        success: false, 
        message: 'This session has not started yet. Please wait for the teacher to start the class.' 
      });
    }

    // Jitsi room name
    const jitsiRoomName = `holistilearn-${session._id}`;

    res.json({
      success: true,
      meeting: {
        url: jitsiRoomName,
        useJitsi: true,
        title: session.title,
        teacherId: session.teacherId,
        isLive: session.status === 'live'
      },
    });
  } catch (error) {
    console.error('Join session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete a session (scheduled or ended)
export const deleteSession = async (req, res) => {
  try {
    const session = await OnlineSession.findById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const currentUserId = req.userId.toString();
    const sessionTeacherId = session.teacherId.toString();

    // Check authorization
    if (sessionTeacherId !== currentUserId) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not authorized to delete this session' 
      });
    }

    // ✅ Allow deletion of scheduled OR ended sessions (not live)
    if (session.status === 'live') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete a live session. Please end it first.' 
      });
    }

    await session.deleteOne();
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};