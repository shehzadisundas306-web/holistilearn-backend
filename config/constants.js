/**
 * Application Constants
 * Centralized configuration values
 */

export default {
  // User Roles
  USER_ROLES: {
    STUDENT: 'student',
    TEACHER: 'teacher',
    ADMIN: 'admin'
  },

  // Difficulty Levels
  DIFFICULTY_LEVELS: {
    BEGINNER: 'beginner',
    INTERMEDIATE: 'intermediate',
    ADVANCED: 'advanced'
  },

  // Mental State Levels
  MENTAL_STATES: {
    STRESS: ['low', 'medium', 'high', 'unknown'],
    MOTIVATION: ['low', 'medium', 'high', 'unknown'],
    ENERGY: ['low', 'medium', 'high', 'unknown'],
    FOCUS: ['low', 'medium', 'high', 'unknown'],
    MOOD: ['happy', 'neutral', 'sad', 'anxious', 'tired', 'energetic']
  },

  // Progress Status
  PROGRESS_STATUS: {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed'
  },

  // Activity Types
  ACTIVITY_TYPES: {
    QUIZ_COMPLETED: 'quiz_completed',
    NOTES_GENERATED: 'notes_generated',
    TOPIC_STARTED: 'topic_started',
    TOPIC_COMPLETED: 'topic_completed',
    ACHIEVEMENT_EARNED: 'achievement_earned',
    MENTAL_STATE_UPDATED: 'mental_state_updated'
  },

  // Categories
  TOPIC_CATEGORIES: [
    'Frontend',
    'Backend',
    'AI',
    'Design',
    'Programming',
    'Database'
  ],

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 50
  },

  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    SERVER_ERROR: 500
  },

  // Error Messages
  ERROR_MESSAGES: {
    UNAUTHORIZED: 'Not authorized to access this route',
    INVALID_TOKEN: 'Invalid token',
    TOKEN_EXPIRED: 'Token expired',
    USER_NOT_FOUND: 'User not found',
    INVALID_CREDENTIALS: 'Invalid credentials',
    EMAIL_NOT_VERIFIED: 'Please verify your email first',
    ACCESS_DENIED: 'Access denied'
  },

  // Success Messages
  SUCCESS_MESSAGES: {
    LOGIN_SUCCESS: 'Login successful',
    REGISTER_SUCCESS: 'Registration successful',
    LOGOUT_SUCCESS: 'Logout successful'
  },

  // AI Configuration
  AI: {
    MODEL: 'gpt-4',
    MAX_TOKENS: {
      NOTES: 2000,
      QUIZ: 2500,
      LEARNING_PATH: 2000
    },
    TEMPERATURE: {
      NOTES: 0.7,
      QUIZ: 0.8,
      LEARNING_PATH: 0.7
    }
  },

  // File Upload
  UPLOAD: {
    MAX_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    MAX_FILES: 5
  },

  // Cache Keys
  CACHE_KEYS: {
    DASHBOARD: (userId) => `dashboard:${userId}`,
    TOPICS: 'topics',
    QUIZZES: (topicId) => `quizzes:${topicId}`
  },

  // Cache TTL (in seconds)
  CACHE_TTL: {
    DASHBOARD: 300, // 5 minutes
    TOPICS: 3600, // 1 hour
    QUIZZES: 1800 // 30 minutes
  },

  // Rate Limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100
  },

  // Learning Path
  LEARNING_PATH: {
    MIN_MILESTONES: 3,
    MAX_MILESTONES: 10,
    DEFAULT_PACE: 'moderate',
    PACES: ['relaxed', 'moderate', 'intensive']
  },

  // Quiz
  QUIZ: {
    MIN_QUESTIONS: 5,
    MAX_QUESTIONS: 20,
    DEFAULT_QUESTIONS: 10,
    TIME_PER_QUESTION: 2 // minutes
  },

  // Streak
  STREAK: {
    RESET_HOUR: 0, // Reset at midnight
    FREEZE_DAYS: 3 // Can miss 3 days without breaking streak
  },

  // Achievements
  ACHIEVEMENTS: [
    {
      id: 'first_quiz',
      name: 'First Quiz',
      description: 'Completed your first quiz',
      icon: '🏆',
      xp: 50
    },
    {
      id: 'perfect_score',
      name: 'Perfect Score',
      description: 'Got 100% on a quiz',
      icon: '🌟',
      xp: 100
    },
    {
      id: 'seven_day_streak',
      name: 'Week Warrior',
      description: 'Maintained a 7-day learning streak',
      icon: '🔥',
      xp: 200
    },
    {
      id: 'notes_master',
      name: 'Notes Master',
      description: 'Generated 10 AI notes',
      icon: '📝',
      xp: 150
    }
  ],

  // Motivational Quotes
  MOTIVATIONAL_QUOTES: {
    low: [
      "Every expert was once a beginner.",
      "Small steps every day lead to big results.",
      "Your only competition is yourself yesterday.",
      "It's not about being the best. It's about being better than you were yesterday.",
      "The expert in anything was once a beginner."
    ],
    medium: [
      "Consistency is more important than intensity.",
      "You're doing great! Keep going.",
      "Progress, not perfection.",
      "Success is the sum of small efforts, repeated day in and day out.",
      "The secret of getting ahead is getting started."
    ],
    high: [
      "You're on fire! Channel that energy!",
      "Today is your day to shine!",
      "Nothing can stop you now!",
      "Your passion is your power.",
      "Great things never come from comfort zones."
    ]
  },

  // Email Templates
  EMAIL_TEMPLATES: {
    VERIFICATION: 'emailVerification',
    PASSWORD_RESET: 'passwordReset',
    WELCOME: 'welcome',
    STREAK_REMINDER: 'streakReminder'
  },

  // Notification Types
  NOTIFICATION_TYPES: {
    ACHIEVEMENT: 'achievement',
    REMINDER: 'reminder',
    MESSAGE: 'message',
    UPDATE: 'update'
  },

  // Timeouts (in milliseconds)
  TIMEOUTS: {
    DATABASE: 5000,
    API: 10000,
    AI: 30000
  }
};