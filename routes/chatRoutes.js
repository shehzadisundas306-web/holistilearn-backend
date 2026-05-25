import express from 'express';
import { protect } from '../middleware/isAuthenticated.js';
import {
    getChatRooms,
    createOrGetChat,
    getChatById,
    getChatMessages,
    sendMessage,
    markMessagesAsRead,
    markMessageAsRead,
    handleTyping,
    deleteChat,
    verifyChatAccess,
    getTeacherChats,
    getTeacherChatMessages,
    deleteMessage,
    clearChatMessages
} from '../controllers/chatController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ==================== GENERAL CHAT ENDPOINTS ====================
router.get('/rooms', getChatRooms);
router.get('/rooms/:chatId', getChatById);
router.post('/rooms/user/:userId', createOrGetChat);
router.delete('/rooms/:chatId', deleteChat);
router.get('/verify/:firebaseChatId', verifyChatAccess);

// ==================== MESSAGE ENDPOINTS ====================
router.get('/:chatId/messages', getChatMessages);
router.post('/send', sendMessage);
router.post('/:chatId/read', markMessagesAsRead);

// ==================== NEW: TYPING & READ RECEIPTS ====================
router.post('/typing', handleTyping);                          // Typing indicator
router.post('/messages/:messageId/read', markMessageAsRead);   // Single message read receipt

// ==================== TEACHER CHAT ENDPOINTS ====================
router.get('/teacher/chats', getTeacherChats);
router.get('/teacher/chats/:chatId/messages', getTeacherChatMessages);

// Add these to your existing routes

// ==================== DELETE MESSAGE ENDPOINTS ====================
router.delete('/messages/:messageId', deleteMessage);           // Delete single message
router.delete('/chats/:chatId/clear', clearChatMessages);       // Clear all messages in chat

export default router;