// backend/routes/notificationRoutes.js
import express from 'express';
import { protect } from '../middleware/isAuthenticated.js';
import {
    getUserNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
    getNotificationSettings,
    updateNotificationSettings
} from '../controllers/notificationController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get notifications
router.get('/', getUserNotifications);
router.get('/unread-count', getUnreadCount);

// Mark as read
router.put('/:notificationId/read', markAsRead);
router.put('/read-all', markAllAsRead);

// Delete
router.delete('/:notificationId', deleteNotification);
router.delete('/', deleteAllNotifications);

// Settings
router.get('/settings', getNotificationSettings);
router.put('/settings', updateNotificationSettings);

export default router;