// backend/controllers/notificationController.js
import Notification from '../models/Notification.js';
import NotificationService from '../services/notificationService.js';

/**
 * Get all notifications for the current user
 */
export const getUserNotifications = async (req, res) => {
    try {
        const userId = req.userId;
        const { page = 1, limit = 20 } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find({ userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Notification.countDocuments({ userId }),
            Notification.countDocuments({ userId, read: false })
        ]);
        
        res.json({
            success: true,
            notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            },
            unreadCount
        });
        
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Get unread notification count
 */
export const getUnreadCount = async (req, res) => {
    try {
        const userId = req.userId;
        const count = await Notification.countDocuments({ userId, read: false });
        
        res.json({ success: true, count });
        
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Mark a notification as read
 */
export const markAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.userId;
        
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, userId },
            { read: true, readAt: new Date() },
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        
        // Emit updated unread count via socket
        const io = req.app.locals.io;
        if (io) {
            const unreadCount = await Notification.countDocuments({ userId, read: false });
            io.to(`user:${userId}`).emit('notification-count-update', { count: unreadCount });
        }
        
        res.json({ success: true, notification });
        
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
    try {
        const userId = req.userId;
        
        await Notification.updateMany(
            { userId, read: false },
            { read: true, readAt: new Date() }
        );
        
        // Emit updated count
        const io = req.app.locals.io;
        if (io) {
            io.to(`user:${userId}`).emit('notification-count-update', { count: 0 });
        }
        
        res.json({ success: true, message: 'All notifications marked as read' });
        
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Delete a notification
 */
export const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.userId;
        
        const notification = await Notification.findOneAndDelete({ _id: notificationId, userId });
        
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        
        // Emit updated count
        const io = req.app.locals.io;
        if (io) {
            const unreadCount = await Notification.countDocuments({ userId, read: false });
            io.to(`user:${userId}`).emit('notification-count-update', { count: unreadCount });
        }
        
        res.json({ success: true, message: 'Notification deleted' });
        
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Delete all notifications for current user
 */
export const deleteAllNotifications = async (req, res) => {
    try {
        const userId = req.userId;
        
        const result = await Notification.deleteMany({ userId });
        
        // Emit updated count
        const io = req.app.locals.io;
        if (io) {
            io.to(`user:${userId}`).emit('notification-count-update', { count: 0 });
        }
        
        res.json({ 
            success: true, 
            message: `Deleted ${result.deletedCount} notifications` 
        });
        
    } catch (error) {
        console.error('Delete all notifications error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Get notification settings for current user
 */
export const getNotificationSettings = async (req, res) => {
    try {
        const userId = req.userId;
        
        // You can store settings in User model or separate Settings model
        // For now, return defaults
        res.json({
            success: true,
            settings: {
                emailNotifications: true,
                pushNotifications: true,
                soundEnabled: true,
                desktopNotifications: false,
                notifyQuizAssigned: true,
                notifyQuizSubmitted: true,
                notifyStudentJoined: true,
                notifyNewMessages: true,
                notifyAchievements: true
            }
        });
        
    } catch (error) {
        console.error('Get notification settings error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Update notification settings
 */
export const updateNotificationSettings = async (req, res) => {
    try {
        const userId = req.userId;
        const settings = req.body;
        
        // Store settings (implement based on your user model)
        // await User.findByIdAndUpdate(userId, { notificationSettings: settings });
        
        res.json({ success: true, message: 'Settings updated', settings });
        
    } catch (error) {
        console.error('Update notification settings error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};