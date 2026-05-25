import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/userModel.js';

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/user/auth/google/callback" // Must match Google Console
  },
  // ... (rest of your imports and config)
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ email: profile.emails[0].value });

      if (!user) {
        // New user: default role to 'none'
        user = await User.create({
          username: profile.displayName,
          email: profile.emails[0].value,
          googleId: profile.id,
          isVerified: true, 
          role: "none",
          // ADD THIS LINE: It generates a random string to satisfy your Schema
          password: Math.random().toString(36).slice(-10) 
        });
      }
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }

));