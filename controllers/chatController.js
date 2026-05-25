import mongoose from 'mongoose';
import ChatRoom from '../models/ChatRoom.js';
import User from '../models/userModel.js';
import Class from '../models/Class.js';
import { db as firestoreDb, FieldValue } from '../config/firebase.js';
import NotificationService from '../services/notificationService.js'; // ✅ ADD THIS

// ==================== HELPER FUNCTIONS ====================

const getUserId = (req) => {
    return req.userId || req.user?._id || req.user?.id;
};

// ==================== CHAT ROOM FUNCTIONS ====================

// Get all chat rooms for current user
export const getChatRooms = async (req, res) => {
    try {
        const userId = getUserId(req);
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const rooms = await ChatRoom.find({
            participants: userId,
            isActive: true
        })
        .populate('participants', '_id name username email avatar role isOnline lastSeen')
        .sort({ updatedAt: -1 });

        const formattedRooms = rooms.map(room => {
            const otherParticipant = room.participants.find(p => p._id.toString() !== userId);
            
            return {
                _id: room._id,
                name: room.name,
                type: room.type,
                firebaseChatId: room.firebaseChatId,
                participants: room.participants,
                otherParticipant: otherParticipant ? {
                    _id: otherParticipant._id,
                    name: otherParticipant.name || otherParticipant.username,
                    email: otherParticipant.email,
                    avatar: otherParticipant.avatar,
                    role: otherParticipant.role,
                    isOnline: otherParticipant.isOnline || false,
                    lastSeen: otherParticipant.lastSeen
                } : null,
                lastMessage: room.lastMessage,
                unreadCount: room.unreadCount?.get(userId) || 0,
                createdAt: room.createdAt,
                updatedAt: room.updatedAt
            };
        });

        res.json({ success: true, data: formattedRooms });
    } catch (error) {
        console.error('Get chat rooms error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create or get existing private chat
export const createOrGetChat = async (req, res) => {
    try {
        const { userId: otherUserId } = req.params;
        const currentUserId = getUserId(req);
        const io = req.app.locals.io;

        if (!currentUserId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        if (currentUserId.toString() === otherUserId) {
            return res.status(400).json({ success: false, message: 'Cannot create chat with yourself' });
        }

        if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        // Check if other user exists
        const otherUser = await User.findById(otherUserId).select('_id name username email avatar role');
        if (!otherUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Find existing chat
        let existingChat = await ChatRoom.findOne({
            type: 'private',
            participants: { $all: [currentUserId, otherUserId], $size: 2 },
            isActive: true
        }).populate('participants', '_id name username email avatar');

        if (existingChat) {
            return res.json({ success: true, data: existingChat, isNew: false });
        }

        // Create new chat
        const sortedIds = [currentUserId.toString(), otherUserId.toString()].sort();
        const firebaseChatId = `private_${sortedIds[0]}_${sortedIds[1]}`;

        const currentUser = await User.findById(currentUserId).select('name username role');
        const currentUserName = currentUser?.name || currentUser?.username || 'User';
        const otherUserName = otherUser.name || otherUser.username;

        const newChat = await ChatRoom.create({
            name: `Chat between ${currentUserName} and ${otherUserName}`,
            type: 'private',
            participants: [currentUserId, otherUserId],
            firebaseChatId,
            createdBy: currentUserId,
            isActive: true,
            unreadCount: new Map()
        });

        await newChat.populate('participants', '_id name username email avatar');
        
        // Create in Firestore
        if (firestoreDb) {
            try {
                await firestoreDb.collection('chats').doc(firebaseChatId).set({
                    participants: [currentUserId.toString(), otherUserId.toString()],
                    type: 'private',
                    createdAt: new Date(),
                    createdBy: currentUserId.toString(),
                    lastMessage: null,
                    lastMessageTime: null,
                    updatedAt: new Date()
                });
            } catch (firestoreError) {
                console.error('Firestore error (non-critical):', firestoreError.message);
            }
        }

        // ✅ SEND ENHANCED NOTIFICATION via NotificationService
        const notificationService = new NotificationService(io);
        
        await notificationService.sendToUser(otherUserId, {
            type: 'new_message',
            title: '💬 New Chat Started',
            message: `${currentUserName} started a conversation with you`,
            link: `/chat/${newChat._id}`,
            icon: '💬',
            color: '#3b82f6',
            priority: 'high',
            data: {
                chatId: newChat._id,
                fromUserId: currentUserId,
                fromUserName: currentUserName,
                fromUserRole: currentUser?.role,
                isNewChat: true
            }
        });

        // ✅ EMIT NEW CHAT EVENT TO BOTH PARTICIPANTS
        if (io) {
            const chatData = {
                _id: newChat._id,
                name: newChat.name,
                type: newChat.type,
                firebaseChatId: newChat.firebaseChatId,
                otherParticipant: {
                    _id: otherUser._id,
                    name: otherUserName,
                    avatar: otherUser.avatar,
                    role: otherUser.role
                },
                createdAt: newChat.createdAt
            };
            
            io.to(`user:${currentUserId}`).emit('new-chat', { chat: chatData });
            io.to(`user:${otherUserId}`).emit('new-chat', { 
                chat: {
                    ...chatData,
                    otherParticipant: {
                        _id: currentUserId,
                        name: currentUserName,
                        avatar: currentUser?.avatar,
                        role: currentUser?.role
                    }
                }
            });
        }

        res.json({ success: true, data: newChat, isNew: true });
    } catch (error) {
        console.error('Create chat error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get messages for a specific chat
export const getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = getUserId(req);
        const io = req.app.locals.io;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            _id: chatId,
            participants: userId,
            isActive: true
        }).populate('participants', '_id name username');

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        let messages = [];

        // Get from Firestore or MongoDB
        if (firestoreDb && chat.firebaseChatId) {
            try {
                const chatDocRef = firestoreDb.collection('chats').doc(chat.firebaseChatId);
                const messagesSnap = await chatDocRef.collection('messages')
                    .orderBy('createdAt', 'asc')
                    .limit(100)
                    .get();
                
                messages = messagesSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        text: data.text,
                        senderId: data.senderId,
                        senderName: data.senderName,
                        createdAt: data.createdAt?.toDate?.() || data.createdAt,
                        isRead: data.readBy?.includes(userId.toString()) || false,
                        isDeleted: data.isDeleted || false,
                        deletedFor: data.deletedFor || []
                    };
                });
            } catch (err) {
                console.error('Firestore error:', err.message);
            }
        }
        
        // Fallback to MongoDB
        if (messages.length === 0 && chat.messages && chat.messages.length > 0) {
            messages = chat.messages.map(msg => ({
                id: msg._id,
                text: msg.text,
                senderId: msg.senderId.toString(),
                senderName: msg.senderName,
                createdAt: msg.createdAt,
                isRead: msg.readBy?.includes(userId) || false,
                isDeleted: msg.isDeleted || false,
                deletedFor: msg.deletedFor || []
            }));
        }

        // Filter out messages deleted for current user
        const filteredMessages = messages.filter(msg => 
            !msg.deletedFor?.includes(userId.toString())
        );

        // Mark messages as read
        let unreadMessageIds = [];
        if (chat.messages) {
            let updated = false;
            chat.messages.forEach(msg => {
                if (msg.senderId.toString() !== userId && !msg.readBy?.includes(userId)) {
                    if (!msg.readBy) msg.readBy = [];
                    msg.readBy.push(userId);
                    unreadMessageIds.push(msg._id);
                    updated = true;
                }
            });
            if (updated) {
                await chat.save();
            }
        }

        // Reset unread count
        if (chat.unreadCount && chat.unreadCount.get(userId.toString()) > 0) {
            chat.unreadCount.set(userId.toString(), 0);
            await chat.save();
        }

        // Emit read receipts
        if (io && unreadMessageIds.length > 0) {
            unreadMessageIds.forEach(msgId => {
                const msg = chat.messages.id(msgId);
                if (msg) {
                    io.to(`user:${msg.senderId}`).emit('message:read-receipt', {
                        messageId: msgId,
                        chatId: chat._id,
                        readBy: userId,
                        readAt: new Date()
                    });
                }
            });
        }

        res.json({ success: true, messages: filteredMessages });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { chatId, text, recipientId } = req.body;
        const senderId = getUserId(req);
        const io = req.app.locals.io;

        if (!senderId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }

        let chat;

        // Find chat by ID or create new one
        if (chatId) {
            chat = await ChatRoom.findOne({
                _id: chatId,
                participants: senderId,
            });
        } else if (recipientId) {
            chat = await ChatRoom.findOne({
                type: 'private',
                participants: { $all: [senderId, recipientId], $size: 2 },
                isActive: true
            });
        }

        if (!chat && recipientId) {
            // Create new chat
            const otherUser = await User.findById(recipientId);
            if (!otherUser) {
                return res.status(404).json({ success: false, message: 'Recipient not found' });
            }

            const sortedIds = [senderId.toString(), recipientId.toString()].sort();
            const firebaseChatId = `private_${sortedIds[0]}_${sortedIds[1]}`;
            
            const currentUser = await User.findById(senderId).select('name username role');
            const currentUserName = currentUser?.name || currentUser?.username || 'User';
            const otherUserName = otherUser.name || otherUser.username;

            chat = await ChatRoom.create({
                name: `Chat between ${currentUserName} and ${otherUserName}`,
                type: 'private',
                participants: [senderId, recipientId],
                firebaseChatId,
                createdBy: senderId,
                isActive: true,
                unreadCount: new Map()
            });

            // ✅ Send enhanced notification for new chat
            const notificationService = new NotificationService(io);
            await notificationService.sendToUser(recipientId, {
                type: 'new_message',
                title: '💬 New Chat Started',
                message: `${currentUserName} sent you a message`,
                link: `/chat/${chat._id}`,
                icon: '💬',
                color: '#3b82f6',
                priority: 'high',
                data: {
                    chatId: chat._id,
                    fromUserId: senderId,
                    fromUserName: currentUserName,
                    messagePreview: text.trim().substring(0, 100),
                    isNewChat: true
                }
            });

            // Also emit socket event
            if (io) {
                const chatData = {
                    _id: chat._id,
                    name: chat.name,
                    type: chat.type,
                    otherParticipant: {
                        _id: senderId,
                        name: currentUserName,
                        role: currentUser?.role
                    }
                };
                io.to(`user:${recipientId}`).emit('new-chat', { chat: chatData });
                io.to(`user:${recipientId}`).emit('new-message-notification', {
                    type: 'new_chat',
                    title: 'New Chat Started',
                    message: `${currentUserName} sent you a message: "${text.trim().substring(0, 50)}..."`,
                    link: `/chat/${chat._id}`,
                    icon: '💬',
                    color: '#3b82f6',
                    chatId: chat._id,
                    from: senderId,
                    fromName: currentUserName,
                    messagePreview: text.trim().substring(0, 100),
                    timestamp: new Date()
                });
            }
        }

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        const sender = await User.findById(senderId).select('name username role');
        const senderName = sender?.name || sender?.username || 'User';
        const isTeacher = sender?.role === 'teacher';

        const messageData = {
            text: text.trim(),
            senderId: senderId.toString(),
            senderName: senderName,
            createdAt: new Date(),
            readBy: [senderId.toString()]
        };

        let messageId = Date.now().toString();

        // Store in Firestore
        if (firestoreDb && chat.firebaseChatId) {
            try {
                const chatDocRef = firestoreDb.collection('chats').doc(chat.firebaseChatId);
                const chatDoc = await chatDocRef.get();
                
                if (!chatDoc.exists) {
                    await chatDocRef.set({
                        participants: chat.participants.map(p => p.toString()),
                        type: 'private',
                        createdAt: new Date(),
                        createdBy: senderId.toString(),
                        lastMessage: null,
                        lastMessageTime: null,
                        updatedAt: new Date()
                    });
                }
                
                const messagesRef = chatDocRef.collection('messages');
                const docRef = await messagesRef.add({
                    text: messageData.text,
                    senderId: messageData.senderId,
                    senderName: messageData.senderName,
                    createdAt: messageData.createdAt,
                    readBy: messageData.readBy
                });
                messageId = docRef.id;
                
                await chatDocRef.update({
                    lastMessage: {
                        text: messageData.text,
                        senderId: messageData.senderId,
                        senderName: messageData.senderName,
                        createdAt: messageData.createdAt
                    },
                    lastMessageTime: messageData.createdAt,
                    updatedAt: new Date()
                });
            } catch (err) {
                console.error('Firestore error:', err.message);
            }
        }

        // Save to MongoDB
        chat.messages = chat.messages || [];
        chat.messages.push({
            _id: messageId,
            text: messageData.text,
            senderId: senderId,
            senderName: messageData.senderName,
            readBy: [senderId],
            createdAt: messageData.createdAt
        });
        
        chat.lastMessage = {
            _id: messageId,
            text: messageData.text,
            senderId: senderId,
            senderName: messageData.senderName,
            createdAt: messageData.createdAt
        };
        
        // Update unread count for other participants
        chat.participants.forEach(participantId => {
            if (participantId.toString() !== senderId) {
                const currentUnread = chat.unreadCount?.get(participantId.toString()) || 0;
                chat.unreadCount.set(participantId.toString(), currentUnread + 1);
            }
        });
        
        await chat.save();

        // ✅ EMIT SOCKET EVENTS FOR REAL-TIME DELIVERY
        const notificationService = new NotificationService(io);
        
        if (io) {
            const messageResponse = {
                id: messageId,
                text: messageData.text,
                senderId: messageData.senderId,
                senderName: messageData.senderName,
                createdAt: messageData.createdAt,
                isRead: false
            };

            // Emit to chat room for all participants
            io.to(`chat:${chat._id}`).emit('message:new', {
                chatId: chat._id,
                message: messageResponse
            });

            // Emit individual notifications to each participant
            for (const participantId of chat.participants) {
                const participantIdStr = participantId.toString();
                
                if (participantIdStr !== senderId) {
                    // Simple message event
                    io.to(`user:${participantIdStr}`).emit('new-message', {
                        chatId: chat._id,
                        message: messageResponse
                    });
                    
                    // ✅ ENHANCED NOTIFICATION via NotificationService
                    await notificationService.sendToUser(participantIdStr, {
                        type: 'new_message',
                        title: isTeacher ? '👨‍🏫 New Teacher Message' : '💬 New Message',
                        message: `${senderName}: ${text.trim().substring(0, 80)}${text.length > 80 ? '...' : ''}`,
                        link: isTeacher ? `/teacher/dashboard/messages/${chat._id}` : `/student/chat/${chat._id}`,
                        icon: '💬',
                        color: '#3b82f6',
                        priority: 'high',
                        data: {
                            chatId: chat._id,
                            messageId: messageId,
                            fromUserId: senderId,
                            fromUserName: senderName,
                            fromUserRole: sender?.role,
                            messagePreview: text.trim().substring(0, 100),
                            isTeacher: isTeacher
                        }
                    });
                    
                    // Also emit socket notification for backward compatibility
                    io.to(`user:${participantIdStr}`).emit('new-message-notification', {
                        type: 'message',
                        title: isTeacher ? 'Teacher Message' : 'New Message',
                        message: `${senderName}: ${text.trim().substring(0, 80)}${text.length > 80 ? '...' : ''}`,
                        link: isTeacher ? `/teacher/dashboard/messages/${chat._id}` : `/student/chat/${chat._id}`,
                        icon: '💬',
                        color: '#3b82f6',
                        priority: 'high',
                        chatId: chat._id,
                        from: senderId,
                        fromName: senderName,
                        isTeacher: isTeacher,
                        messagePreview: text.trim().substring(0, 100),
                        timestamp: messageData.createdAt
                    });
                }
            }
        }

        res.json({
            success: true,
            message: {
                id: messageId,
                text: messageData.text,
                senderId: messageData.senderId,
                senderName: messageData.senderName,
                createdAt: messageData.createdAt,
                isRead: false
            }
        });
        
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const handleTyping = async (req, res) => {
    try {
        const { chatId, isTyping, recipientId } = req.body;
        const userId = getUserId(req);
        const io = req.app.locals.io;
        
        if (!io) return res.json({ success: true });
        
        const user = await User.findById(userId).select('name username role');
        const userName = user?.name || user?.username || 'User';
        
        // Emit to chat room
        io.to(`chat:${chatId}`).emit('user:typing', {
            chatId,
            userId,
            userName,
            userRole: user?.role,
            isTyping
        });
        
        // Emit individually to recipient
        if (recipientId && recipientId.toString() !== userId.toString()) {
            io.to(`user:${recipientId}`).emit('user:typing', {
                chatId,
                userId,
                userName,
                userRole: user?.role,
                isTyping
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Typing handler error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Mark a single message as read
export const markMessageAsRead = async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = getUserId(req);
        const io = req.app.locals.io;
        
        const chat = await ChatRoom.findOne({
            'messages._id': messageId,
            participants: userId
        });
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        
        const message = chat.messages.id(messageId);
        if (message && message.senderId.toString() !== userId) {
            if (!message.readBy) message.readBy = [];
            if (!message.readBy.includes(userId)) {
                message.readBy.push(userId);
                await chat.save();
                
                // Emit read receipt
                if (io) {
                    io.to(`user:${message.senderId}`).emit('message:read-receipt', {
                        messageId,
                        chatId: chat._id,
                        readBy: userId,
                        readAt: new Date()
                    });
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Mark message read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Mark all messages in chat as read
export const markMessagesAsRead = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = getUserId(req);
        const io = req.app.locals.io;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            _id: chatId,
            participants: userId,
            isActive: true
        });

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        // Find unread messages and mark them
        let unreadMessageIds = [];
        if (chat.messages) {
            chat.messages.forEach(msg => {
                if (msg.senderId.toString() !== userId && !msg.readBy?.includes(userId)) {
                    if (!msg.readBy) msg.readBy = [];
                    msg.readBy.push(userId);
                    unreadMessageIds.push(msg._id);
                }
            });
            await chat.save();
        }

        // Reset unread count
        if (chat.unreadCount) {
            chat.unreadCount.set(userId.toString(), 0);
            await chat.save();
        }

        // Emit read receipts for all messages
        if (io && unreadMessageIds.length > 0) {
            unreadMessageIds.forEach(msgId => {
                const msg = chat.messages.id(msgId);
                if (msg) {
                    io.to(`user:${msg.senderId}`).emit('message:read-receipt', {
                        messageId: msgId,
                        chatId: chat._id,
                        readBy: userId,
                        readAt: new Date()
                    });
                }
            });
        }

        res.json({ success: true, message: 'Messages marked as read' });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete chat
export const deleteChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({ _id: chatId, participants: userId });
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        chat.isActive = false;
        await chat.save();

        res.json({ success: true, message: 'Chat deleted' });
    } catch (error) {
        console.error('Delete chat error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Verify Firebase chat access
export const verifyChatAccess = async (req, res) => {
    try {
        const { firebaseChatId } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            firebaseChatId,
            participants: userId,
            isActive: true
        });

        if (!chat) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        res.json({
            success: true,
            data: {
                allowed: true,
                chatId: chat._id,
                firebaseChatId: chat.firebaseChatId,
                type: chat.type
            }
        });
    } catch (error) {
        console.error('Verify access error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ==================== TEACHER CHAT FUNCTIONS ====================

// Get all chats for a teacher
export const getTeacherChats = async (req, res) => {
    try {
        const teacherId = getUserId(req);
        
        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }
        
        const directChats = await ChatRoom.find({
            type: 'private',
            participants: teacherId,
            isActive: true,
            $expr: { $gt: [{ $size: "$participants" }, 1] }
        }).populate('participants', '_id name username email avatar isOnline lastSeen');
        
        const formattedDirectChats = directChats.map(chat => {
            const otherParticipant = chat.participants.find(p => p._id.toString() !== teacherId);
            if (!otherParticipant) {
                return null; // Skip this chat
            }
            return {
                id: chat._id,
                type: 'direct',
                participant: otherParticipant ? {
                    id: otherParticipant._id,
                    name: otherParticipant.name || otherParticipant.username,
                    email: otherParticipant.email,
                    avatar: otherParticipant.avatar,
                    isOnline: otherParticipant.isOnline || false,
                    lastSeen: otherParticipant.lastSeen
                } : null,
                lastMessage: chat.lastMessage,
                unreadCount: chat.unreadCount?.get(teacherId.toString()) || 0,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt
            };
        });
        
        const allChats = [...formattedDirectChats].sort((a, b) => {
            const timeA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt) : new Date(0);
            const timeB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt) : new Date(0);
            return timeB - timeA;
        });
        
        res.json({ success: true, chats: allChats });
    } catch (error) {
        console.error('Get teacher chats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get messages for a specific teacher chat
export const getTeacherChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const teacherId = getUserId(req);
        
        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }
        
        const chat = await ChatRoom.findOne({
            _id: chatId,
            participants: teacherId,
            isActive: true
        });
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }
        
        const messages = chat.messages || [];
        
        const formattedMessages = messages.map(msg => ({
            id: msg._id,
            text: msg.text,
            senderId: msg.senderId,
            senderName: msg.senderName,
            createdAt: msg.createdAt,
            isRead: msg.readBy?.includes(teacherId) || false
        }));
        
        // Mark messages as read
        if (chat.messages) {
            let updated = false;
            chat.messages.forEach(msg => {
                if (msg.senderId.toString() !== teacherId && !msg.readBy?.includes(teacherId)) {
                    if (!msg.readBy) msg.readBy = [];
                    msg.readBy.push(teacherId);
                    updated = true;
                }
            });
            if (updated) {
                await chat.save();
            }
        }
        
        res.json({
            success: true,
            messages: formattedMessages,
            chat: {
                id: chat._id,
                name: chat.name,
                type: chat.type,
                participants: chat.participants
            }
        });
    } catch (error) {
        console.error('Get teacher chat messages error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get chat by ID with participant details
export const getChatById = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            _id: chatId,
            participants: userId,
            isActive: true
        }).populate('participants', '_id name username email avatar role isOnline lastSeen');

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        res.json({ success: true, data: chat });
    } catch (error) {
        console.error('Get chat by ID error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// DELETE MESSAGE (Soft Delete)
export const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { deleteForEveryone = false } = req.body;
        const userId = getUserId(req);
        const io = req.app.locals.io;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            'messages._id': messageId,
            participants: userId,
            isActive: true
        });

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        const message = chat.messages.id(messageId);
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        const isSender = message.senderId.toString() === userId.toString();

        if (!isSender && deleteForEveryone) {
            return res.status(403).json({ success: false, message: 'Only the sender can delete for everyone' });
        }

        if (deleteForEveryone && isSender) {
            message.isDeleted = true;
            message.deletedBy = userId;
            message.deletedAt = new Date();
            message.text = 'This message was deleted';
            
            if (chat.lastMessage && chat.lastMessage._id?.toString() === messageId) {
                chat.lastMessage.text = 'This message was deleted';
                chat.lastMessage.isDeleted = true;
            }
            
            await chat.save();
            
            if (firestoreDb && chat.firebaseChatId) {
                try {
                    const chatDocRef = firestoreDb.collection('chats').doc(chat.firebaseChatId);
                    await chatDocRef.collection('messages').doc(messageId).update({
                        isDeleted: true,
                        deletedBy: userId.toString(),
                        deletedAt: new Date(),
                        text: 'This message was deleted'
                    });
                } catch (err) {
                    console.error('Firestore delete error:', err.message);
                }
            }
            
            io.to(`chat:${chat._id}`).emit('message:deleted-for-everyone', {
                messageId,
                chatId: chat._id,
                deletedBy: userId,
                deletedAt: new Date()
            });
            
        } else {
            if (!message.deletedFor) message.deletedFor = [];
            if (!message.deletedFor.includes(userId)) {
                message.deletedFor.push(userId);
                await chat.save();
            }
            
            io.to(`user:${userId}`).emit('message:deleted-for-me', {
                messageId,
                chatId: chat._id
            });
        }

        res.json({
            success: true,
            message: deleteForEveryone ? 'Message deleted for everyone' : 'Message deleted for you'
        });

    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// BULK DELETE MESSAGES (Clear chat)
export const clearChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const { deleteForEveryone = false } = req.body;
        const userId = getUserId(req);
        const io = req.app.locals.io;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const chat = await ChatRoom.findOne({
            _id: chatId,
            participants: userId,
            isActive: true
        });

        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        if (deleteForEveryone) {
            let modified = false;
            chat.messages.forEach(msg => {
                if (msg.senderId.toString() === userId.toString() && !msg.isDeleted) {
                    msg.isDeleted = true;
                    msg.deletedBy = userId;
                    msg.deletedAt = new Date();
                    msg.text = 'This message was deleted';
                    modified = true;
                }
            });
            
            if (modified) {
                await chat.save();
                
                io.to(`chat:${chat._id}`).emit('chat:cleared-for-everyone', {
                    chatId: chat._id,
                    clearedBy: userId,
                    clearedAt: new Date()
                });
            }
        } else {
            chat.messages.forEach(msg => {
                if (!msg.deletedFor) msg.deletedFor = [];
                if (!msg.deletedFor.includes(userId)) {
                    msg.deletedFor.push(userId);
                }
            });
            await chat.save();
            
            chat.unreadCount?.set(userId.toString(), 0);
            await chat.save();
            
            io.to(`user:${userId}`).emit('chat:cleared-for-me', {
                chatId: chat._id
            });
        }

        res.json({
            success: true,
            message: deleteForEveryone ? 'Your messages deleted for everyone' : 'Chat cleared for you'
        });

    } catch (error) {
        console.error('Clear chat error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};