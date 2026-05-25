// backend/models/userModel.js
import mongoose from "mongoose";
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
    // Basic Information
    username: { 
        type: String, 
        required: [true, 'Username is required'],
        trim: true,
        minlength: [2, 'Username must be at least 2 characters'],
        maxlength: [50, 'Username cannot exceed 50 characters']
    },
    name: {
        type: String,
        trim: true,
        minlength: [2, 'Name must be at least 2 characters'],
        maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: { 
        type: String, 
        
        required: [true, 'Email is required'], 
        unique: true, 
        lowercase: true, 
        trim: true,
        match: [
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
            'Please provide a valid email'
        ]
    },
    password: { 
        type: String, 
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    
    // Verification & Authentication
    isVerified: { 
        type: Boolean, 
        default: false 
    },
    emailVerified: { 
        type: Boolean, 
        default: false 
    },
    isLoggedIn: { 
        type: Boolean, 
        default: false 
    },
    token: { 
        type: String, 
        default: null 
    },
    otp: { 
        type: String, 
        default: null 
    },
    otpExpiry: { 
        type: Date, 
        default: null 
    },
    verificationToken: String,
    verificationTokenExpire: Date,
    passwordResetToken: String,
    passwordResetExpire: Date,
    
    // Role & Permissions
    role: {
        type: String,
        enum: ['student', 'teacher', 'admin', 'none'],
        default: 'none'
    },
    
    // Google OAuth
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    
    // Profile Information
    profile: {
        avatar: {
            type: String,
            default: 'default-avatar.png'
        },
        bio: {
            type: String,
            maxlength: [500, 'Bio cannot exceed 500 characters']
        },
        preferredLearningStyle: {
            type: String,
            enum: ['visual', 'auditory', 'reading', 'kinesthetic'],
            default: 'visual'
        },
        notificationPreferences: {
            email: { type: Boolean, default: true },
            push: { type: Boolean, default: true }
        },
        timezone: {
            type: String,
            default: 'UTC'
        }
    },
    
    // Activity Tracking
    lastLogin: Date,
    loginCount: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // ... existing fields
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  chatSettings: {
    notifications: { type: Boolean, default: true },
    soundEnabled: { type: Boolean, default: true },
    theme: { type: String, default: 'dark' }
  },
    // User Settings
    settings: {
        theme: {
            type: String,
            enum: ['light', 'dark', 'system'],
            default: 'system'
        },
        language: {
            type: String,
            default: 'en'
        },
        emailNotifications: {
            type: Boolean,
            default: true
        },
        pushNotifications: {
            type: Boolean,
            default: true
        }
    },
    
    // Metadata
    metadata: {
        registeredFrom: String,
        lastIp: String,
        userAgent: String
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for student progress
userSchema.virtual('progress', {
    ref: 'StudentProgress',
    localField: '_id',
    foreignField: 'studentId',
    justOne: true
});

// Virtual for mental state
userSchema.virtual('mentalState', {
    ref: 'MentalState',
    localField: '_id',
    foreignField: 'studentId',
    justOne: true
});

// Virtual for recent activities
userSchema.virtual('recentActivities', {
    ref: 'Activity',
    localField: '_id',
    foreignField: 'studentId',
    options: { limit: 5, sort: { 'activities.timestamp': -1 } }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    if (!candidatePassword || !this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

// Generate verification token
userSchema.methods.generateVerificationToken = function() {
    const token = crypto.randomBytes(32).toString('hex');
    
    this.verificationToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
    
    this.verificationTokenExpire = Date.now() + 24 * 60 * 60 * 1000;
    
    return token;
};

// Generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
    const token = crypto.randomBytes(32).toString('hex');
    
    this.passwordResetToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
    
    this.passwordResetExpire = Date.now() + 60 * 60 * 1000;
    
    return token;
};

// Generate OTP
userSchema.methods.generateOTP = function() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otp = otp;
    this.otpExpiry = Date.now() + 10 * 60 * 1000;
    return otp;
};

// Verify OTP
userSchema.methods.verifyOTP = function(otp) {
    if (!this.otp || !this.otpExpiry) return false;
    if (Date.now() > this.otpExpiry) return false;
    return this.otp === otp;
};

// Update last login
userSchema.methods.updateLastLogin = function(ip, userAgent) {
    this.lastLogin = Date.now();
    this.loginCount += 1;
    this.isLoggedIn = true;
    if (this.metadata) {
        this.metadata.lastIp = ip;
        this.metadata.userAgent = userAgent;
    }
};

// Get public profile
userSchema.methods.getPublicProfile = function() {
    return {
        id: this._id,
        username: this.username,
        name: this.name || this.username,
        email: this.email,
        role: this.role,
        profile: this.profile,
        isVerified: this.isVerified || this.emailVerified,
        createdAt: this.createdAt,
        lastLogin: this.lastLogin
    };
};

// Check if email is verified
userSchema.methods.isEmailVerified = function() {
    return this.isVerified || this.emailVerified;
};

// Update profile
userSchema.methods.updateProfile = function(profileData) {
    if (profileData.username) this.username = profileData.username;
    if (profileData.name) this.name = profileData.name;
    if (profileData.profile) {
        this.profile = {
            ...this.profile,
            ...profileData.profile
        };
    }
    if (profileData.settings) {
        this.settings = {
            ...this.settings,
            ...profileData.settings
        };
    }
};

// // Indexes
// userSchema.index({ email: 1 });
// userSchema.index({ username: 1 });
// userSchema.index({ role: 1 });
// userSchema.index({ googleId: 1 }, { sparse: true });
// userSchema.index({ 'profile.preferredLearningStyle': 1 });

const User = mongoose.model("User", userSchema);

export default User;