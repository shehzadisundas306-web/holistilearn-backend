// backend/controllers/authController.js
import mongoose from "mongoose";
import { verifyMail } from "../emailVerify/verifyMail.js";
import { Session } from "../models/sessionModel.js";
import User from "../models/userModel.js";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendOtpMail } from "../emailVerify/sendOtpMail.js";
import TeacherProfile from "../models/teacherProfile.js";
import NotificationService from "../services/notificationService.js";

export const registerUser = async (req, resp) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return resp.status(400).json({ success: false, message: "All fields are required" });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return resp.status(400).json({ success: false, message: "User already exists" });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            username,
            email,
            password: hashedPassword,
            isVerified: false,
            role: 'none'
        });
        
        const token = jwt.sign({ id: newUser._id }, process.env.SECRET_KEY, { expiresIn: "10m" });
        verifyMail(token, email);
        newUser.token = token;
        await newUser.save();
        
        // ✅ SEND NOTIFICATION TO ALL ADMINS
        const io = req.app?.locals?.io;
        if (io) {
            const notificationService = new NotificationService(io);
            
            await notificationService.sendToRole('admin', {
                type: 'new_registration',
                title: '🆕 New User Registered!',
                message: `${username} (${email}) just joined the platform.`,
                link: '/admin/users',
                icon: '👤',
                color: '#3b82f6',
                priority: 'medium',
                data: {
                    userId: newUser._id,
                    username: username,
                    email: email,
                    role: 'none',
                    registeredAt: new Date().toISOString()
                }
            });
            
            console.log(`✅ Admin notification sent for new user: ${username}`);
        }
        
        return resp.status(201).json({ 
            success: true, 
            message: "User registered successfully. Please verify your email.", 
            data: {
                id: newUser._id,
                username: newUser.username,
                email: newUser.email,
                isVerified: newUser.isVerified
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const verification = async (req, resp) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return resp.status(401).json({ success: false, message: 'The authorization token is missing or invalid' });
        }
        
        const token = authHeader.split(" ")[1];
        let decoded;
        
        try {
            decoded = jwt.verify(token, process.env.SECRET_KEY);
        } catch (err) {
            if (err.name === "TokenExpiredError") {
                return resp.status(400).json({ success: false, message: 'The registration token has expired' });
            }
            return resp.status(400).json({ success: false, message: 'Token verification failed' });
        }
        
        const user = await User.findById(decoded.id);
        if (!user) {
            return resp.status(400).json({ success: false, message: 'User not found' });
        }
        
        user.token = null;
        user.isVerified = true;
        user.emailVerified = true;
        await user.save();
        
        // ✅ Send notification to admin about email verification
        const io = req.app?.locals?.io;
        if (io && user.role !== 'none') {
            const notificationService = new NotificationService(io);
            
            await notificationService.sendToRole('admin', {
                type: 'system',
                title: '✅ Email Verified',
                message: `${user.username} has verified their email address.`,
                link: '/admin/users',
                icon: '✅',
                color: '#10b981',
                priority: 'low',
                data: {
                    userId: user._id,
                    username: user.username,
                    verifiedAt: new Date().toISOString()
                }
            });
        }
        
        return resp.status(200).json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verification error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const login = async (req, resp) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return resp.status(400).json({ success: false, message: 'All fields are required' });
        }
        
        const user = await User.findOne({ email }).select('+password');
        
        if (!user) {
            return resp.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        // Check if user has a password (for Google OAuth users)
        if (!user.password) {
            return resp.status(401).json({ 
                success: false, 
                message: 'This account uses Google login. Please sign in with Google.' 
            });
        }
        
        const passwordCheck = await bcrypt.compare(password, user.password);
        if (!passwordCheck) {
            return resp.status(401).json({ success: false, message: 'Incorrect password' });
        }

        // Check if account is blocked
        if (!user.isActive) {
            return resp.status(403).json({ 
                success: false, 
                message: 'Your account has been blocked by the administrator. Please contact support.' 
            });
        }

        // Check if user is verified
        if (!user.isVerified && !user.emailVerified) {
            return resp.status(403).json({ success: false, message: 'Please verify your email before logging in' });
        }

        // TEACHER APPROVAL CHECK
        if (user.role === 'teacher') {
            const teacherProfile = await TeacherProfile.findOne({ userId: user._id });
            
            if (!teacherProfile) {
                return resp.status(403).json({ 
                    success: false, 
                    message: 'Please complete your teacher profile before logging in.',
                    requiresProfile: true
                });
            }
            
            if (!teacherProfile.isApproved) {
                return resp.status(403).json({ 
                    success: false, 
                    message: 'Your teacher account is pending admin approval. Please wait for approval.',
                    pendingApproval: true,
                    pendingSince: teacherProfile.createdAt
                });
            }
        }

        // Check for existing session and delete it
        const existingSession = await Session.findOne({ userId: user._id });
        if (existingSession) {
            await Session.deleteOne({ userId: user._id });
        }

        // Create a new session
        await Session.create({ userId: user._id });

        // Generate Token
        const accessToken = jwt.sign({ id: user._id }, process.env.SECRET_KEY, { expiresIn: '10d' });
        const refreshToken = jwt.sign({ id: user._id }, process.env.SECRET_KEY, { expiresIn: '30d' });
        
        user.isLoggedIn = true;
        user.lastLogin = new Date();
        user.loginCount = (user.loginCount || 0) + 1;
        await user.save();
        
        // Get teacher profile data if applicable
        let teacherData = null;
        if (user.role === 'teacher') {
            const teacherProfile = await TeacherProfile.findOne({ userId: user._id });
            if (teacherProfile) {
                teacherData = {
                    isApproved: teacherProfile.isApproved,
                    isProfileComplete: teacherProfile.isProfileComplete,
                    degree: teacherProfile.degree,
                    specialization: teacherProfile.specialization
                };
            }
        }
        
        // Remove sensitive data before sending
        const userData = {
            id: user._id,
            username: user.username,
            name: user.name || user.username,
            email: user.email,
            role: user.role,
            profile: user.profile,
            isVerified: user.isVerified || user.emailVerified,
            isActive: user.isActive,
            createdAt: user.createdAt,
            teacherData: teacherData
        };
        
        // ✅ Send login notification to user (optional - can be turned off)
        const io = req.app?.locals?.io;
        if (io && io.to) {
            // Notify that user is online (for chat status)
            io.to(`user:${user._id}`).emit('user:status-change', {
                userId: user._id,
                isOnline: true,
                lastSeen: new Date()
            });
        }
        
        return resp.status(200).json({ 
            success: true, 
            message: `Welcome back ${user.username}`,
            accessToken, 
            refreshToken, 
            user: userData
        });
    } catch (error) {
        console.error('Login error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const logout = async (req, resp) => {
    try {
        const userId = req.userId;
        
        // Update user status
        await User.findByIdAndUpdate(userId, { 
            isLoggedIn: false,
            isOnline: false,
            lastSeen: new Date()
        });
        
        // Delete session
        await Session.deleteMany({ userId });
        
        // Notify about offline status
        const io = req.app?.locals?.io;
        if (io && io.to) {
            io.to(`user:${userId}`).emit('user:status-change', {
                userId: userId,
                isOnline: false,
                lastSeen: new Date()
            });
        }
        
        return resp.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const forgotPassword = async (req, resp) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) {
            return resp.status(404).json({ success: false, message: "User not found" });
        }
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);
        
        user.otp = otp;
        user.otpExpiry = expiry;
        await user.save();
        await sendOtpMail(email, otp);
        
        return resp.status(200).json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Forgot password error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const verifyOtp = async (req, resp) => {
    const { otp } = req.body;
    const email = req.params.email;
    
    if (!otp) {
        return resp.status(400).json({ success: false, message: 'OTP is required' });
    }
    
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return resp.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!user.otp || !user.otpExpiry) {
            return resp.status(400).json({ success: false, message: 'OTP not generated or already verified' });
        }
        
        if (user.otpExpiry < new Date()) {
            return resp.status(400).json({ success: false, message: 'OTP has expired. Please request a new one' });
        }
        
        if (otp !== user.otp) {
            return resp.status(400).json({ success: false, message: 'Invalid OTP' });
        }
        
        user.otp = null;
        user.otpExpiry = null;
        await user.save();
        
        return resp.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (error) {
        console.error('Verify OTP error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const changePassword = async (req, resp) => {
    const { newPassword, confirmPassword } = req.body;
    const email = req.params.email;

    if (!newPassword || !confirmPassword) {
        return resp.status(400).json({ success: false, message: "All fields are required" });
    }

    if (newPassword !== confirmPassword) {
        return resp.status(400).json({ success: false, message: "Passwords do not match" });
    }

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return resp.status(404).json({ success: false, message: "User not found" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();
        
        // ✅ Notify user about password change (optional)
        const io = req.app?.locals?.io;
        if (io && io.to) {
            const notificationService = new NotificationService(io);
            await notificationService.sendToUser(user._id, {
                type: 'system',
                title: '🔐 Password Changed',
                message: 'Your password was successfully changed.',
                icon: '🔐',
                color: '#10b981',
                priority: 'low',
                link: '/profile'
            });
        }

        return resp.status(200).json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error('Change password error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const updateRole = async (req, resp) => {
    try {
        const { role } = req.body;
        const userId = req.userId;

        if (!['student', 'teacher'].includes(role)) {
            return resp.status(400).json({ success: false, message: "Invalid role selected" });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { role: role },
            { new: true }
        ).select('-password');

        if (!user) {
            return resp.status(404).json({ success: false, message: "User not found" });
        }
        
        // ✅ Notify admin about role change request (if becoming teacher)
        const io = req.app?.locals?.io;
        if (io && role === 'teacher') {
            const notificationService = new NotificationService(io);
            
            await notificationService.sendToRole('admin', {
                type: 'system',
                title: '👨‍🏫 Teacher Role Request',
                message: `${user.username} has requested to become a teacher. Please review their profile.`,
                link: '/admin/users',
                icon: '👨‍🏫',
                color: '#f59e0b',
                priority: 'high',
                data: {
                    userId: user._id,
                    username: user.username,
                    email: user.email,
                    requestedRole: role
                }
            });
        }

        return resp.status(200).json({
            success: true,
            message: "Role updated successfully",
            user
        });
    } catch (error) {
        console.error('Update role error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};
export const googleCallback = (req, res) => {
    try {
        const token = jwt.sign({ id: req.user._id }, process.env.SECRET_KEY, { expiresIn: '10d' });
        
        // Check if user is a teacher and needs profile setup
        const user = req.user;
        let redirectUrl = `http://localhost:3000/google-success?token=${token}`;
        
        // Add additional params for special cases
        if (user.role === 'teacher') {
            // Check if teacher profile exists
            // This would need to be checked in your passport strategy
            if (!user.hasTeacherProfile) {
                redirectUrl += '&requiresProfile=true';
            } else if (!user.isTeacherApproved) {
                redirectUrl += '&pendingApproval=true';
            }
        } else if (user.role === 'none') {
            redirectUrl += '&selectRole=true';
        }
        
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Google callback error:', error);
        res.redirect('http://localhost:3000/login?error=auth_failed');
    }
};

export const getMe = async (req, resp) => {
    try {
        const user = await User.findById(req.userId).select("-password");
        
        if (!user) {
            return resp.status(404).json({ success: false, message: "User not found" });
        }

        return resp.status(200).json({
            success: true,
            user: {
                id: user._id,
                username: user.username,
                name: user.name || user.username,
                email: user.email,
                role: user.role,
                profile: user.profile,
                isVerified: user.isVerified || user.emailVerified,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('Get me error:', error);
        return resp.status(500).json({ success: false, message: error.message });
    }
};

export const getCurrentUser = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password -__v');
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ success: true, data: user });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const getUserById = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        
        const user = await User.findById(userId)
            .select('-password -__v');
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ success: true, data: user });
    } catch (error) {
        console.error('Get user by ID error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const getAllUsers = async (req, res) => {
    try {
        const currentUserId = req.userId || req.user?._id;
        
        console.log('Current user ID from token:', currentUserId);
        
        if (!currentUserId) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not authenticated. Please login again.' 
            });
        }
        
        const users = await User.find({ 
            _id: { $ne: currentUserId },
            isActive: { $ne: false }
        })
            .select('_id username name email avatar role bio isOnline lastSeen')
            .lean();
        
        const formattedUsers = users.map(user => ({
            _id: user._id,
            name: user.name || user.username,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            bio: user.bio,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
        }));
        
        console.log(`✅ Found ${formattedUsers.length} users`);
        
        res.json({ 
            success: true, 
            data: formattedUsers,
            count: formattedUsers.length 
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching users',
            error: error.message 
        });
    }
};

export const getTeachers = async (req, res) => {
    try {
        console.log('Fetching teachers...');
        
        const teachers = await User.find({ 
            role: 'teacher',
            isActive: { $ne: false }
        })
            .select('_id username name email avatar role bio subject rating studentsCount isOnline lastSeen')
            .lean();
        
        console.log(`Raw teachers found: ${teachers.length}`);
        
        const formattedTeachers = teachers.map(teacher => ({
            _id: teacher._id,
            name: teacher.name || teacher.username,
            username: teacher.username,
            email: teacher.email,
            avatar: teacher.avatar,
            role: teacher.role,
            bio: teacher.bio,
            subject: teacher.subject || 'General',
            rating: teacher.rating || 0,
            isOnline: teacher.isOnline || false,
            lastSeen: teacher.lastSeen
        }));
        
        console.log(`✅ Found ${formattedTeachers.length} teachers`);
        
        res.json({ 
            success: true, 
            data: formattedTeachers,
            count: formattedTeachers.length 
        });
    } catch (error) {
        console.error('Get teachers error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching teachers',
            error: error.message 
        });
    }
};

export const searchUsers = async (req, res) => {
    try {
        const { q } = req.query;
        const currentUserId = req.user.id;
        
        if (!q || q.trim() === '') {
            return res.json({ success: true, data: [] });
        }
        
        const searchTerm = q.trim();
        
        const users = await User.find({
            _id: { $ne: currentUserId },
            isActive: { $ne: false },
            $or: [
                { name: { $regex: searchTerm, $options: 'i' } },
                { email: { $regex: searchTerm, $options: 'i' } }
            ]
        })
            .select('_id name email avatar role bio isOnline')
            .limit(20)
            .sort({ name: 1 });
        
        console.log(`✅ Search for "${searchTerm}" found ${users.length} users`);
        
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ success: false, message: 'Error searching users' });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, avatar, bio, subject } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (avatar) updateData.avatar = avatar;
        if (bio) updateData.bio = bio;
        if (subject && req.user.role === 'teacher') updateData.subject = subject;
        
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -__v');
        
        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        console.log(`✅ Updated user: ${updatedUser.name}`);
        
        res.json({ success: true, data: updatedUser });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Error updating profile' });
    }
};

export const updateOnlineStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const { isOnline } = req.body;
        
        await User.findByIdAndUpdate(userId, { 
            isOnline: isOnline,
            lastSeen: new Date()
        });
        
        // Broadcast status change to all connected users
        const io = req.app?.locals?.io;
        if (io && io.to) {
            io.emit('user:status-change', {
                userId: userId,
                isOnline: isOnline,
                lastSeen: new Date()
            });
        }
        
        res.json({ success: true, message: 'Status updated' });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ success: false, message: 'Error updating status' });
    }
};

export const getTeachersPaginated = async (req, res) => {
    try {
        const currentUserId = req.userId || req.user?._id;
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const subject = req.query.subject || '';
        
        console.log('📚 Fetching teachers with pagination...');
        
        let query = {
            role: 'teacher',
            isActive: { $ne: false }
        };
        
        if (currentUserId) {
            query._id = { $ne: currentUserId };
        }
        
        if (search && search.trim() !== '') {
            query.name = { $regex: search.trim(), $options: 'i' };
        }
        
        if (subject && subject.trim() !== '') {
            query.subject = { $regex: subject.trim(), $options: 'i' };
        }
        
        const skip = (page - 1) * limit;
        const total = await User.countDocuments(query);
        
        const teachers = await User.find(query)
            .select('_id username name email avatar role bio subject rating isOnline lastSeen')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();
        
        const formattedTeachers = teachers.map(teacher => ({
            _id: teacher._id,
            name: teacher.name || teacher.username,
            username: teacher.username,
            email: teacher.email,
            avatar: teacher.avatar,
            role: teacher.role,
            bio: teacher.bio,
            subject: teacher.subject || 'General',
            rating: teacher.rating || 0,
            isOnline: teacher.isOnline || false,
            lastSeen: teacher.lastSeen
        }));
        
        console.log(`✅ Found ${formattedTeachers.length} teachers (Total: ${total})`);
        
        res.json({
            success: true,
            data: {
                teachers: formattedTeachers,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNextPage: page < Math.ceil(total / limit),
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get teachers paginated error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching teachers',
            error: error.message
        });
    }
};

export const getTeacherSubjects = async (req, res) => {
    try {
        const subjects = await User.distinct('subject', { 
            role: 'teacher',
            subject: { $exists: true, $ne: null, $ne: '' }
        });
        
        const filteredSubjects = subjects
            .filter(s => s && s.trim() !== '')
            .sort();
        
        console.log(`✅ Found ${filteredSubjects.length} unique subjects`);
        
        res.json({
            success: true,
            data: filteredSubjects
        });
    } catch (error) {
        console.error('Get subjects error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subjects'
        });
    }
};