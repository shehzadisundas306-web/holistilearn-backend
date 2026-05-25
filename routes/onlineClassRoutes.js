// backend/routes/onlineClassRoutes.js
import express from 'express';
import { protect, authorize } from '../middleware/isAuthenticated.js';
import {
  createOnlineSession,
  getSessionsByClass,
  getSessionById,
  startSession,
  joinSession,
  deleteSession,
  checkTeacherActiveSession,
  joinSessionParticipant,
  leaveSessionParticipant,
  getSessionParticipants,
  endSession,
} from '../controllers/onlineClassController.js';

const router = express.Router();

// ==================== TEACHER ROUTES ====================

// Create a new session
router.post('/create', protect, authorize('teacher'), createOnlineSession);

// Start a session (teacher only)
router.put('/:sessionId/start', protect, authorize('teacher'), startSession);

// End a session (teacher only) - kicks all participants
router.post('/:sessionId/end', protect, authorize('teacher'), endSession);

// Delete a scheduled session (teacher only)
router.delete('/:sessionId', protect, authorize('teacher'), deleteSession);

// Check if teacher has an active live session
router.get('/teacher/active-session', protect, authorize('teacher'), checkTeacherActiveSession);

// ==================== PARTICIPANT ROUTES (Real-time) ====================

// Join session as participant (records attendance)
router.post('/:sessionId/participant/join', protect, joinSessionParticipant);

// Leave session as participant
router.post('/:sessionId/participant/leave', protect, leaveSessionParticipant);

// Get all active participants in a session
router.get('/:sessionId/participants', protect, getSessionParticipants);

// ==================== SHARED ROUTES (Student & Teacher) ====================

// Get all sessions for a class
router.get('/class/:classId', protect, getSessionsByClass);

// Get single session details
router.get('/:sessionId', protect, getSessionById);

// Get meeting info to join a session (returns Jitsi URL)
router.post('/:sessionId/join', protect, joinSession);

export default router;