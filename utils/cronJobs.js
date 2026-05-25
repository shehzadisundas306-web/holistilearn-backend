// backend/utils/cronJobs.js
import cron from 'node-cron';
import OnlineSession from '../models/OnlineSession.js';

/**
 * Start the cron job that automatically ends live sessions when their end time is reached
 * This runs every minute to check for expired sessions
 * 
 * @param {Object} io - Socket.io instance for emitting events
 */
export const startSessionAutoEndCron = (io) => {
  // Schedule task to run every minute (at second 0)
  cron.schedule('* * * * *', async () => {
    console.log('🕐 Running session auto-end check...', new Date().toLocaleString());
    
    const now = new Date();
    
    try {
      // Find all live sessions that have passed their scheduled end time
      const expiredSessions = await OnlineSession.find({
        status: 'live',
        scheduledEnd: { $lte: now }
      });
      
      if (expiredSessions.length === 0) {
        // No expired sessions found
        return;
      }
      
      console.log(`⏰ Found ${expiredSessions.length} expired session(s) to auto-end`);
      
      for (const session of expiredSessions) {
        console.log(`  - Auto-ending session: "${session.title}" (${session._id})`);
        
        try {
          // Use the model's endSession method to properly end the session
          await session.endSession('auto');
          
          console.log(`  ✅ Successfully auto-ended session: ${session.title}`);
          
          // Emit socket event to all participants in this session's room
          if (io) {
            io.to(`session:${session._id}`).emit('session-auto-ended', {
              sessionId: session._id,
              title: session.title,
              message: 'The session time has ended. The class is now closed.',
              timestamp: now,
              endedBy: 'auto'
            });
            
            // Also emit to the class room for any listeners
            io.to(`class:${session.classId}`).emit('session-ended', {
              sessionId: session._id,
              title: session.title,
              reason: 'time_expired',
              timestamp: now
            });
            
            console.log(`  📡 Socket events emitted for session: ${session._id}`);
          }
        } catch (sessionError) {
          console.error(`  ❌ Error ending session ${session._id}:`, sessionError);
        }
      }
      
      console.log(`✅ Auto-end cron completed. Ended ${expiredSessions.length} session(s).`);
      
    } catch (error) {
      console.error('❌ Session auto-end cron error:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Karachi" // Adjust to your timezone
  });
  
  console.log('✅ Session auto-end cron job initialized (runs every minute)');
};

/**
 * Optional: Run a one-time check to fix any sessions that should have ended but didn't
 * This is useful for server restarts or manual fixes
 * 
 * @param {Object} io - Socket.io instance for emitting events
 */
export const fixOrphanedSessions = async (io) => {
  console.log('🔧 Running orphaned session fix...');
  
  const now = new Date();
  
  try {
    const orphanedSessions = await OnlineSession.find({
      status: 'live',
      scheduledEnd: { $lte: now }
    });
    
    if (orphanedSessions.length === 0) {
      console.log('No orphaned sessions found');
      return { fixed: 0 };
    }
    
    console.log(`Found ${orphanedSessions.length} orphaned session(s)`);
    
    for (const session of orphanedSessions) {
      await session.endSession('system');
      
      if (io) {
        io.to(`session:${session._id}`).emit('session-auto-ended', {
          sessionId: session._id,
          title: session.title,
          message: 'The session has been automatically closed by the system.',
          timestamp: now,
          endedBy: 'system'
        });
      }
    }
    
    console.log(`Fixed ${orphanedSessions.length} orphaned session(s)`);
    return { fixed: orphanedSessions.length };
    
  } catch (error) {
    console.error('Error fixing orphaned sessions:', error);
    return { fixed: 0, error: error.message };
  }
};

/**
 * Optional: Check if a specific session needs to be auto-ended
 * 
 * @param {string} sessionId - Session ID to check
 * @param {Object} io - Socket.io instance
 */
export const checkAndAutoEndSession = async (sessionId, io) => {
  try {
    const session = await OnlineSession.findById(sessionId);
    
    if (!session) {
      return { success: false, message: 'Session not found' };
    }
    
    if (session.status !== 'live') {
      return { success: false, message: 'Session is not live' };
    }
    
    const now = new Date();
    
    if (session.scheduledEnd <= now) {
      await session.endSession('auto');
      
      if (io) {
        io.to(`session:${sessionId}`).emit('session-auto-ended', {
          sessionId: session._id,
          title: session.title,
          message: 'The session time has ended.',
          timestamp: now,
          endedBy: 'auto'
        });
      }
      
      return { success: true, message: 'Session auto-ended' };
    }
    
    return { success: true, message: 'Session still active' };
  } catch (error) {
    console.error('Check session error:', error);
    return { success: false, message: error.message };
  }
};

// Export all functions
export default {
  startSessionAutoEndCron,
  fixOrphanedSessions,
  checkAndAutoEndSession
};