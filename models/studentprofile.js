import mongoose from "mongoose";

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },

    difficultyLevel: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced"],
      default: "Beginner"
    },

    learningTarget: {
      type: String,
      enum: ["Exam Preparation", "Concept Building", "Advanced Mastery"],
      default: "Concept Building"
    },

    interests: [
      {
        type: String
      }
    ],

    totalQuizzesTaken: {
      type: Number,
      default: 0
    },

    averageScore: {
      type: Number,
      default: 0
    },

    completedTopics: [
      {
        type: String
      }
    ],

    weakAreas: [
      {
        type: String
      }
    ],

    learningStreak: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

export const StudentProfile = mongoose.model(
  "StudentProfile",
  studentProfileSchema
);