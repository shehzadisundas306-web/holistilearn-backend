// backend/middleware/isAuthenticated.js
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import 'dotenv/config';

// ===============================
// 🔐 AUTHENTICATION MIDDLEWARE
// ===============================
export const isAuthenticated = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token is missing or invalid'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.SECRET_KEY);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.'
        });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please login again.'
        });
      }
      throw jwtError;
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ CHECK IF USER IS ACTIVE (Blocked check)
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked by the administrator. Please contact support.',
        isBlocked: true
      });
    }

    // ✅ CHECK IF USER IS DELETED (Soft delete)
    if (user.deletedAt) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deleted.',
        isDeleted: true
      });
    }

    // ✅ NORMALIZE ROLE
    const normalizedUser = {
      ...user.toObject(),
      role: user.role?.trim().toLowerCase() || 'none'
    };

    req.user = normalizedUser;
    req.userId = normalizedUser._id;
    req.userRole = normalizedUser.role;
    req.tokenExp = decoded.exp;
    req.tokenIat = decoded.iat;

    next();
  } catch (error) {
    console.error("Auth Error:", error.message);

    return res.status(500).json({
      success: false,
      message: 'Authentication failed. Please try again.'
    });
  }
};

// ===============================
// 🎯 ROLE AUTHORIZATION MIDDLEWARE
// ===============================
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const userRole = req.user.role; // already normalized

    const allowedRoles = roles.map(r => r.toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${userRole}' is not authorized.`,
        requiredRoles: allowedRoles
      });
    }

    next();
  };
};

// ===============================
// 🔄 OPTIONAL AUTH (SAFE)
// ===============================
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.SECRET_KEY);

      if (!decoded || !decoded.id) {
        return next();
      }

      const user = await User.findById(decoded.id).select('-password');

      if (user && user.isActive !== false && !user.deletedAt) {
        req.user = {
          ...user.toObject(),
          role: user.role?.trim().toLowerCase() || 'none'
        };
        req.userId = user._id;
        req.userRole = req.user.role;
      }
    } catch (err) {
      // Invalid token in optional auth - just ignore
      console.log('Optional auth: invalid token ignored');
    }

    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    next();
  }
};

// ===============================
// 📧 EMAIL VERIFICATION CHECK
// ===============================
export const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  if (!req.user.emailVerified && !req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required. Please verify your email address.'
    });
  }

  next();
};

// ===============================
// 🔑 TOKEN GENERATOR
// ===============================
export const generateToken = (id) => {
  if (!id) {
    throw new Error('User ID is required to generate token');
  }
  
  return jwt.sign(
    { id },
    process.env.SECRET_KEY,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

// ===============================
// ⚡ TOKEN REFRESH HELPER
// ===============================
export const refreshTokenIfNeeded = (req, res, next) => {
  const originalJson = res.json;

  res.json = function (data) {
    try {
      if (req.user && req.userId && req.tokenExp && req.tokenIat) {
        const now = Math.floor(Date.now() / 1000);
        const totalLife = req.tokenExp - req.tokenIat;
        const remaining = req.tokenExp - now;
        
        // Refresh if less than 50% of token life remains
        if (remaining < totalLife / 2 && remaining > 0) {
          const newToken = generateToken(req.userId);
          res.setHeader('X-New-Token', newToken);
          
          // Also add to response body if needed
          if (data && typeof data === 'object') {
            data.newToken = newToken;
          }
        }
      }
    } catch (err) {
      console.log('Token refresh check failed:', err.message);
    }

    return originalJson.call(this, data);
  };

  next();
};

// ===============================
// 🚫 SPECIFIC ROLE CHECK MIDDLEWARE (For readability)
// ===============================
export const isStudent = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Student access required' });
  }
  
  next();
};

export const isTeacher = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ success: false, message: 'Teacher access required' });
  }
  
  next();
};

export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  
  next();
};

// ===============================
// 🔁 BACKWARD COMPATIBILITY
// ===============================
export const protect = isAuthenticated;

// ===============================
// 📊 RATE LIMITING FOR SENSITIVE ROUTES (Optional)
// ===============================
const requestCounts = new Map();

export const rateLimit = (maxRequests = 10, windowMs = 60000) => {
  return (req, res, next) => {
    const userId = req.userId || req.ip;
    const key = `${userId}_${req.path}`;
    const now = Date.now();
    
    if (!requestCounts.has(key)) {
      requestCounts.set(key, [{ timestamp: now, count: 1 }]);
      return next();
    }
    
    const requests = requestCounts.get(key);
    const windowStart = now - windowMs;
    
    // Filter requests within time window
    const validRequests = requests.filter(r => r.timestamp > windowStart);
    const totalRequests = validRequests.reduce((sum, r) => sum + r.count, 0);
    
    if (totalRequests >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: `Too many requests. Please try again later.`
      });
    }
    
    validRequests.push({ timestamp: now, count: 1 });
    requestCounts.set(key, validRequests);
    
    // Clean up old entries periodically
    if (requestCounts.size > 1000) {
      for (const [k, v] of requestCounts.entries()) {
        const recent = v.filter(r => r.timestamp > Date.now() - 60000);
        if (recent.length === 0) {
          requestCounts.delete(k);
        } else {
          requestCounts.set(k, recent);
        }
      }
    }
    
    next();
  };
};