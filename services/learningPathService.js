// backend/services/learningPathService.js
import LearningPath from '../models/LearningPath.js';
import StudentProgress from '../models/StudentProgress.js';
import QuizHistory from '../models/QuizHistory.js';
import MentalState from '../models/MentalState.js';

class LearningPathService {
  async generatePath(studentId, { goal, difficulty = 'intermediate', timeCommitment = 5, forceCreate = false }) {
    try {
      console.log('🚀 Starting generatePath for:', { studentId, goal, difficulty, forceCreate });
      
      if (!goal) throw new Error('Goal is required');

      // ✅ DELETE existing path to ensure clean slate
      await LearningPath.deleteOne({ studentId });
      console.log('🗑️ Deleted existing path for fresh start');

      // ✅ Create milestones
      const goalTitle = goal.charAt(0).toUpperCase() + goal.slice(1);
      
      const milestones = [
        {
          title: "Foundations",
          description: `Learn the core concepts and basics of ${goalTitle}`,
          order: 0,
          status: "available",
          topics: [
            {
              title: `Introduction to ${goalTitle}`,
              description: `Get started with the basics of ${goalTitle}`,
              estimatedTime: 60,
              skills: ["Fundamentals"],
              status: "pending"
            },
            {
              title: `Core Principles of ${goalTitle}`,
              description: `Understand the key principles`,
              estimatedTime: 90,
              skills: ["Core Concepts"],
              status: "pending"
            }
          ],
          estimatedTime: 150,
          progress: 0,
          quizzes: [],
          projects: []
        },
        {
          title: "Core Concepts",
          description: `Master the essential concepts of ${goalTitle}`,
          order: 1,
          status: "locked",
          topics: [
            {
              title: `Advanced ${goalTitle}`,
              description: `Deep dive into advanced concepts`,
              estimatedTime: 120,
              skills: ["Advanced Concepts"],
              status: "pending"
            },
            {
              title: `Best Practices in ${goalTitle}`,
              description: `Learn industry best practices`,
              estimatedTime: 90,
              skills: ["Best Practices"],
              status: "pending"
            }
          ],
          estimatedTime: 210,
          progress: 0,
          quizzes: [],
          projects: []
        },
        {
          title: difficulty === 'beginner' ? "Practical Application" : "Advanced Topics",
          description: difficulty === 'beginner' ? `Apply your ${goalTitle} knowledge` : `Explore advanced ${goalTitle} concepts`,
          order: 2,
          status: "locked",
          topics: [
            {
              title: difficulty === 'beginner' ? `Practical ${goalTitle} Projects` : `Advanced ${goalTitle} Techniques`,
              description: difficulty === 'beginner' ? `Build real-world projects` : `Master complex topics`,
              estimatedTime: 180,
              skills: difficulty === 'beginner' ? ["Project Building"] : ["Advanced Techniques"],
              status: "pending"
            }
          ],
          estimatedTime: 180,
          progress: 0,
          quizzes: [],
          projects: []
        },
        {
          title: "Mastery Project",
          description: `Complete a final project to demonstrate ${goalTitle} mastery`,
          order: 3,
          status: "locked",
          topics: [
            {
              title: `Capstone Project: ${goalTitle}`,
              description: `Build a complete project from scratch`,
              estimatedTime: 240,
              skills: ["Project Building", "Integration"],
              status: "pending"
            }
          ],
          estimatedTime: 240,
          progress: 0,
          quizzes: [],
          projects: []
        }
      ];

      console.log('📊 Created', milestones.length, 'milestones');
      console.log('📊 First milestone status:', milestones[0].status);

      // ✅ Create learning path data
      const learningPathData = {
        goal: goal,
        description: `Master ${goal} through this structured learning path`,
        difficulty: difficulty || 'intermediate',
        estimatedDuration: { value: 4, unit: 'weeks' },
        milestones: milestones,
        progress: 0,
        startedAt: new Date(),
        status: 'active',
        lastUpdated: new Date()
      };

      // ✅ Create new document
      const userPath = new LearningPath({ studentId });
      userPath.currentPath = learningPathData;
      
      userPath.aiRecommendations = {
        lastGenerated: new Date(),
        adaptations: [],
        learningPace: 'moderate',
        focusAreas: [],
        suggestedResources: []
      };
      
      userPath.settings = {
        notifications: { milestoneReminder: true, deadlineAlert: true, weeklyProgress: true },
        preferredStudyTime: 'morning',
        dailyGoal: 60,
        adaptivePacing: true
      };

      await userPath.save();
      console.log('✅ Learning path saved successfully!');

      // ✅ Verify save
      const verifyPath = await LearningPath.findOne({ studentId });
      console.log('🔍 VERIFICATION - Has currentPath:', !!verifyPath?.currentPath);
      console.log('🔍 VERIFICATION - Milestones count:', verifyPath?.currentPath?.milestones?.length);
      
      if (verifyPath?.currentPath?.milestones && verifyPath.currentPath.milestones.length > 0) {
        console.log('🔍 VERIFICATION - First milestone title:', verifyPath.currentPath.milestones[0].title);
        console.log('🔍 VERIFICATION - First milestone status:', verifyPath.currentPath.milestones[0].status);
      } else {
        console.error('❌ CRITICAL: Milestones not saved to database!');
      }

      return {
        success: true,
        data: learningPathData,
        warning: false,
        message: 'Learning path created successfully'
      };

    } catch (error) {
      console.error('Learning path generation error:', error);
      throw error;
    }
  }

  async archivePath(studentId, goal) {
    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (!learningPath || !learningPath.currentPath) {
        return { success: false, message: 'No active learning path found' };
      }
      
      if (!learningPath.completedPaths) learningPath.completedPaths = [];
      
      const milestonesCopy = learningPath.currentPath.milestones ? 
        learningPath.currentPath.milestones.map(m => ({
          ...(m.toObject ? m.toObject() : m),
          topics: m.topics ? m.topics.map(t => ({ ...t })) : []
        })) : [];
      
      learningPath.completedPaths.push({
        goal: learningPath.currentPath.goal,
        description: learningPath.currentPath.description,
        difficulty: learningPath.currentPath.difficulty,
        duration: learningPath.currentPath.progress,
        startedAt: learningPath.currentPath.startedAt,
        completedAt: new Date(),
        milestonesCompleted: learningPath.currentPath.milestones?.filter(m => m.status === 'completed').length || 0,
        topicsCovered: [],
        skillsGained: [],
        milestones: milestonesCopy,
        progress: learningPath.currentPath.progress || 0,
        status: 'archived'
      });
      
      learningPath.currentPath = null;
      await learningPath.save();
      
      return { success: true, message: `Path "${goal}" archived successfully` };
      
    } catch (error) {
      console.error('Archive path error:', error);
      throw error;
    }
  }

  async getAllPaths(studentId) {
    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (!learningPath) {
        return {
          success: true,
          data: {
            activePath: null,
            pausedPaths: [],
            completedPaths: []
          }
        };
      }
      
      const pausedPaths = (learningPath.completedPaths || []).filter(p => p.status === 'paused');
      const completedPaths = (learningPath.completedPaths || []).filter(p => p.status !== 'paused');
      
      return {
        success: true,
        data: {
          activePath: learningPath.currentPath || null,
          pausedPaths: pausedPaths,
          completedPaths: completedPaths
        }
      };
    } catch (error) {
      console.error('Get all paths error:', error);
      throw error;
    }
  }

  async pauseCurrentPath(studentId) {
    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (!learningPath || !learningPath.currentPath) {
        return { success: false, message: 'No active learning path found' };
      }
      
      if (learningPath.currentPath.status !== 'active') {
        return { success: false, message: `Cannot pause path with status: ${learningPath.currentPath.status}` };
      }
      
      if (!learningPath.completedPaths) learningPath.completedPaths = [];
      
      const milestonesCopy = learningPath.currentPath.milestones ? 
        learningPath.currentPath.milestones.map(m => ({
          ...(m.toObject ? m.toObject() : m),
          topics: m.topics ? m.topics.map(t => ({ ...t })) : []
        })) : [];
      
      learningPath.completedPaths.push({
        goal: learningPath.currentPath.goal,
        description: learningPath.currentPath.description,
        difficulty: learningPath.currentPath.difficulty,
        duration: learningPath.currentPath.progress,
        startedAt: learningPath.currentPath.startedAt,
        completedAt: null,
        milestonesCompleted: learningPath.currentPath.milestones?.filter(m => m.status === 'completed').length || 0,
        topicsCovered: [],
        skillsGained: [],
        milestones: milestonesCopy,
        progress: learningPath.currentPath.progress || 0,
        status: 'paused'
      });
      
      learningPath.currentPath = null;
      await learningPath.save();
      
      return { success: true, message: 'Learning path paused successfully' };
      
    } catch (error) {
      console.error('Pause path error:', error);
      throw error;
    }
  }

  async resumePath(studentId, goal) {
    try {
      const learningPath = await LearningPath.findOne({ studentId });
      
      if (!learningPath || !learningPath.completedPaths || learningPath.completedPaths.length === 0) {
        return { success: false, message: 'No paused paths found' };
      }
      
      const pausedPathIndex = learningPath.completedPaths.findIndex(p => p.goal === goal && p.status === 'paused');
      
      if (pausedPathIndex === -1) {
        return { success: false, message: `No paused path found for goal: ${goal}` };
      }
      
      const pausedPath = learningPath.completedPaths[pausedPathIndex];
      
      if (learningPath.currentPath && learningPath.currentPath.status === 'active') {
        return {
          success: false,
          warning: true,
          message: 'You already have an active learning path. Please pause or complete it first.',
          existingPath: {
            goal: learningPath.currentPath.goal,
            progress: learningPath.currentPath.progress
          }
        };
      }
      
      learningPath.currentPath = {
        goal: pausedPath.goal,
        description: pausedPath.description,
        difficulty: pausedPath.difficulty,
        estimatedDuration: pausedPath.estimatedDuration || { value: 4, unit: 'weeks' },
        milestones: pausedPath.milestones,
        progress: pausedPath.progress || 0,
        startedAt: pausedPath.startedAt,
        status: 'active',
        lastUpdated: new Date()
      };
      
      learningPath.completedPaths.splice(pausedPathIndex, 1);
      await learningPath.save();
      
      return {
        success: true,
        data: learningPath.currentPath,
        message: `Resumed learning path: ${goal}`
      };
      
    } catch (error) {
      console.error('Resume path error:', error);
      throw error;
    }
  }
}

export default new LearningPathService();