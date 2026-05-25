import mongoose from 'mongoose';

// Message Sub-schema
const messageSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  text: { type: String, required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  
  // Deletion fields
  isDeleted: { type: Boolean, default: false },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Editing fields
  editedAt: { type: Date },
  editedText: { type: String },
  isEdited: { type: Boolean, default: false }
}, { _id: false });

// Last Message Sub-schema
const lastMessageSchema = new mongoose.Schema({
  _id: { type: String },
  text: { type: String },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  senderName: { type: String },
  createdAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false }
}, { _id: false });

const chatRoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['private', 'group', 'course'],
    default: 'private'
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null
  },
  firebaseChatId: {
    type: String,
    required: true,
    unique: true
  },
  lastMessage: lastMessageSchema,
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  messages: [messageSchema],
  settings: {
    allowReactions: { type: Boolean, default: true },
    allowEditing: { type: Boolean, default: true },
    allowDeletion: { type: Boolean, default: true },
    deleteForEveryoneTimeout: { type: Number, default: 3600 },
    autoDeleteAfterDays: { type: Number, default: null }
  }
}, {
  timestamps: true
});

// ✅ REMOVE duplicate indexes - only keep these (remove from schema options)
chatRoomSchema.index({ participants: 1 });
chatRoomSchema.index({ updatedAt: -1 });
// firebaseChatId already has unique: true, so don't index again
chatRoomSchema.index({ 'messages.createdAt': -1 });
chatRoomSchema.index({ 'messages.senderId': 1 });
chatRoomSchema.index({ 'messages.isDeleted': 1 });
chatRoomSchema.index({ 'messages.deletedFor': 1 });

// ✅ FIXED pre-save middleware - Simple and clean
chatRoomSchema.pre('save', function() {
  if (this.isNew && this.firebaseChatId) {
    const self = this;
    return mongoose.model('ChatRoom').findOne({ firebaseChatId: this.firebaseChatId })
      .then(existing => {
        if (existing) {
          self.firebaseChatId = `${self.firebaseChatId}_${Date.now()}`;
        }
      });
  }
});

// Virtual for unread messages count
chatRoomSchema.virtual('unreadMessagesCount').get(function() {
  const userId = this._currentUserId;
  if (!userId) return 0;
  return this.unreadCount?.get(userId.toString()) || 0;
});

// Method to add a message
chatRoomSchema.methods.addMessage = async function(messageData) {
  const message = {
    _id: messageData.id || Date.now().toString(),
    text: messageData.text,
    senderId: messageData.senderId,
    senderName: messageData.senderName,
    readBy: [messageData.senderId],
    createdAt: messageData.createdAt || new Date()
  };
  
  this.messages.push(message);
  
  this.lastMessage = {
    _id: message._id,
    text: message.text,
    senderId: message.senderId,
    senderName: message.senderName,
    createdAt: message.createdAt,
    isDeleted: false
  };
  
  // Increment unread count for other participants
  this.participants.forEach(participantId => {
    if (participantId.toString() !== message.senderId.toString()) {
      const currentUnread = this.unreadCount?.get(participantId.toString()) || 0;
      this.unreadCount.set(participantId.toString(), currentUnread + 1);
    }
  });
  
  await this.save();
  return message;
};

// Method to delete a message
chatRoomSchema.methods.deleteMessage = async function(messageId, userId, deleteForEveryone = false) {
  const message = this.messages.id(messageId);
  
  if (!message) {
    throw new Error('Message not found');
  }
  
  const isSender = message.senderId.toString() === userId.toString();
  
  if (deleteForEveryone && !isSender) {
    throw new Error('Only the sender can delete for everyone');
  }
  
  if (deleteForEveryone && isSender) {
    message.isDeleted = true;
    message.deletedBy = userId;
    message.deletedAt = new Date();
    message.text = 'This message was deleted';
    
    if (this.lastMessage && this.lastMessage._id === messageId) {
      this.lastMessage.text = 'This message was deleted';
      this.lastMessage.isDeleted = true;
    }
  } else {
    if (!message.deletedFor) message.deletedFor = [];
    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
    }
  }
  
  await this.save();
  return { message, deletedForEveryone: deleteForEveryone };
};

// Method to get messages for a user
chatRoomSchema.methods.getMessagesForUser = function(userId, limit = 100, skip = 0) {
  const filteredMessages = this.messages
    .filter(msg => !msg.deletedFor?.includes(userId))
    .slice(skip, skip + limit);
  
  return filteredMessages;
};

// Method to mark messages as read
chatRoomSchema.methods.markMessagesAsRead = async function(userId) {
  let modified = false;
  
  this.messages.forEach(msg => {
    if (msg.senderId.toString() !== userId.toString() && !msg.readBy?.includes(userId)) {
      if (!msg.readBy) msg.readBy = [];
      msg.readBy.push(userId);
      modified = true;
    }
  });
  
  if (this.unreadCount && this.unreadCount.get(userId.toString()) > 0) {
    this.unreadCount.set(userId.toString(), 0);
    modified = true;
  }
  
  if (modified) {
    await this.save();
  }
  
  return modified;
};

// Static method to get or create private chat
chatRoomSchema.statics.getOrCreatePrivateChat = async function(userId1, userId2) {
  let chat = await this.findOne({
    type: 'private',
    participants: { $all: [userId1, userId2], $size: 2 },
    isActive: true
  });
  
  if (!chat) {
    const sortedIds = [userId1.toString(), userId2.toString()].sort();
    const firebaseChatId = `private_${sortedIds[0]}_${sortedIds[1]}`;
    
    chat = await this.create({
      name: `Private Chat`,
      type: 'private',
      participants: [userId1, userId2],
      firebaseChatId,
      createdBy: userId1,
      isActive: true,
      unreadCount: new Map()
    });
  }
  
  return chat;
};

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
export default ChatRoom;