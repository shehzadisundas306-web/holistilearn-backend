// backend/services/notificationService.js
import Notification from '../models/Notification.js';
import User from '../models/userModel.js';
import mongoose from 'mongoose';

class NotificationService {
    constructor(io) {
        this.io = io;
    }

    /**
     * Send notification to a specific user
     */
    async sendToUser(userId, notification, options = {}) {
        try {
            const { saveToDb = true, emitSocket = true } = options;
            
            let savedNotification = null;
            
            if (saveToDb) {
                savedNotification = await Notification.create({
                    userId,
                    ...notification,
                    deliveredAt: new Date(),
                    read: false
                });
            }
            
            if (emitSocket && this.io) {
                const notificationToSend = savedNotification ? {
                    id: savedNotification._id,
                    ...notification,
                    createdAt: savedNotification.createdAt
                } : {
                    id: Date.now(),
                    ...notification,
                    createdAt: new Date()
                };
                
                // Emit to user's room
                this.io.to(`user:${userId}`).emit('new-notification', notificationToSend);
                
                // Get and emit updated unread count
                const unreadCount = await Notification.getUnreadCount(userId);
                this.io.to(`user:${userId}`).emit('notification-count-update', { count: unreadCount });
            }
            
            return savedNotification;
            
        } catch (error) {
            console.error('Error sending notification to user:', error);
            return null;
        }
    }

    /**
     * Send notification to multiple users
     */
    async sendToMultipleUsers(userIds, notification, options = {}) {
        const promises = userIds.map(userId => this.sendToUser(userId, notification, options));
        const results = await Promise.allSettled(promises);
        
        return results.filter(r => r.status === 'fulfilled').map(r => r.value);
    }

    /**
     * Send notification to all users with a specific role
     */
    async sendToRole(role, notification, options = {}) {
        const users = await User.find({ role, isActive: true }).select('_id');
        const userIds = users.map(u => u._id);
        
        if (userIds.length === 0) return [];
        
        return this.sendToMultipleUsers(userIds, notification, options);
    }

    /**
     * Send notification to all students in a class
     */
    async sendToClass(classId, notification, options = {}) {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(classId).populate('students.studentId', '_id');
        
        if (!classData) return [];
        
        const studentIds = classData.students
            .filter(s => s.studentId)
            .map(s => s.studentId._id);
        
        if (studentIds.length === 0) return [];
        
        return this.sendToMultipleUsers(studentIds, notification, options);
    }

    /**
     * Send notification to all students in multiple classes
     */
    async sendToClasses(classIds, notification, options = {}) {
        const Class = mongoose.model('Class');
        const classes = await Class.find({ _id: { $in: classIds } }).populate('students.studentId', '_id');
        
        const allStudentIds = new Set();
        classes.forEach(cls => {
            cls.students.forEach(s => {
                if (s.studentId) allStudentIds.add(s.studentId._id.toString());
            });
        });
        
        if (allStudentIds.size === 0) return [];
        
        return this.sendToMultipleUsers(Array.from(allStudentIds), notification, options);
    }

    /**
     * Send notification to teacher of a class
     */
    async sendToTeacher(classId, notification, options = {}) {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(classId).select('teacherId');
        
        if (!classData || !classData.teacherId) return null;
        
        return this.sendToUser(classData.teacherId, notification, options);
    }

    /**
     * Broadcast to all connected users
     */
    broadcastToAll(event, data) {
        if (this.io) {
            this.io.emit(event, data);
        }
    }

    /**
     * Send system notification to all users
     */
    async sendSystemNotification(title, message, options = {}) {
        const users = await User.find({ isActive: true }).select('_id');
        const userIds = users.map(u => u._id);
        
        return this.sendToMultipleUsers(userIds, {
            type: 'system',
            title,
            message,
            icon: options.icon || '🔔',
            color: options.color || '#6b7280',
            priority: options.priority || 'low',
            link: options.link || null,
            data: options.data || {}
        }, options);
    }

    /**
     * Get notifications for a user
     */
    async getUserNotifications(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        
        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find({ userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Notification.countDocuments({ userId }),
            Notification.getUnreadCount(userId)
        ]);
        
        return {
            notifications,
            total,
            unreadCount,
            page,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId, userId) {
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, userId, read: false },
            { read: true, readAt: new Date() },
            { new: true }
        );
        
        if (notification && this.io) {
            const unreadCount = await Notification.getUnreadCount(userId);
            this.io.to(`user:${userId}`).emit('notification-count-update', { count: unreadCount });
        }
        
        return notification;
    }

    /**
     * Mark all notifications as read for a user
     */
    async markAllAsRead(userId) {
        const result = await Notification.updateMany(
            { userId, read: false },
            { read: true, readAt: new Date() }
        );
        
        if (this.io) {
            this.io.to(`user:${userId}`).emit('notification-count-update', { count: 0 });
        }
        
        return result;
    }

    /**
     * Delete notification
     */
    async deleteNotification(notificationId, userId) {
        const result = await Notification.findOneAndDelete({ _id: notificationId, userId });
        
        if (result && this.io) {
            const unreadCount = await Notification.getUnreadCount(userId);
            this.io.to(`user:${userId}`).emit('notification-count-update', { count: unreadCount });
        }
        
        return result;
    }

    /**
     * Delete all notifications for a user
     */
    async deleteAllNotifications(userId) {
        const result = await Notification.deleteMany({ userId });
        
        if (this.io) {
            this.io.to(`user:${userId}`).emit('notification-count-update', { count: 0 });
        }
        
        return result;
    }

    /**
     * Clean old notifications (older than days)
     */
    async cleanOldNotifications(days = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        return await Notification.deleteMany({ createdAt: { $lt: cutoffDate }, read: true });
    }
}

export default NotificationService;