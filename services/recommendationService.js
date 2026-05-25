/**
 * Recommendation Service
 * Generates personalized learning content using a hybrid recommendation engine
 */

import Topic from '../models/Topic.js';
import QuizHistory from '../models/QuizHistory.js';
import StudentProgress from '../models/StudentProgress.js';
import MentalState from '../models/MentalState.js';
import RecommendedTopics from '../models/RecommendedTopics.js';
import constants from '../config/constants.js';

class RecommendationService {
  /**
   * Generate personalized recommendations for a student
   * @param {string} studentId - Student ID
   * @returns {Promise<Object>} Recommendations
   */
  async generateRecommendations(studentId) {
    try {
      // Get student data
      const [quizHistory, progress, mentalState] = await Promise.all([
        QuizHistory.findOne({ studentId }),
        StudentProgress.findOne({ studentId }),
        MentalState.findOne({ studentId })
      ]);

      // Get all available topics
      const allTopics = await Topic.find({ isPublished: true })
        .select('title description category difficulty duration prerequisites')
        .lean();

      // Generate different types of recommendations
      const [
        forYou,
        basedOnWeaknesses,
        basedOnPrerequisites,
        basedOnMentalState,
        trending
      ] = await Promise.all([
        this.recommendForYou(allTopics, quizHistory, progress),
        this.recommendBasedOnWeaknesses(allTopics, quizHistory),
        this.recommendBasedOnPrerequisites(allTopics, progress),
        this.recommendBasedOnMentalState(allTopics, mentalState),
        this.getTrendingTopics(allTopics)
      ]);

      // Combine and score all recommendations
      const allRecommendations = this.combineRecommendations([
        ...forYou,
        ...basedOnWeaknesses,
        ...basedOnPrerequisites,
        ...basedOnMentalState,
        ...trending
      ]);

      // Remove duplicates and sort by relevance
      const uniqueRecommendations = this.removeDuplicates(allRecommendations);
      const sortedRecommendations = this.sortByRelevance(uniqueRecommendations);

      // Get top 20 recommendations
      const topRecommendations = sortedRecommendations.slice(0, 20);

      // Save to database
      await this.saveRecommendations(studentId, topRecommendations);

      return {
        recommendations: topRecommendations.slice(0, 10),
        categories: {
          forYou: forYou.slice(0, 5),
          basedOnWeaknesses: basedOnWeaknesses.slice(0, 5),
          basedOnPrerequisites: basedOnPrerequisites.slice(0, 5),
          trending: trending.slice(0, 5)
        },
        metadata: {
          generatedAt: new Date(),
          totalConsidered: allTopics.length,
          totalRecommended: topRecommendations.length
        }
      };

    } catch (error) {
      console.error('Recommendation generation error:', error);
      throw error;
    }
  }

  /**
   * Recommend topics based on user interests and history
   */
  async recommendForYou(allTopics, quizHistory, progress) {
    const recommendations = [];

    const completedTopics = progress?.topicsProgress
      ?.filter(t => t.status === 'completed')
      .map(t => t.topicId) || [];

    const inProgressTopics = progress?.topicsProgress
      ?.filter(t => t.status === 'in_progress')
      .map(t => t.topicId) || [];

    const interestedCategories = await this.getInterestedCategories(allTopics, completedTopics);

    allTopics.forEach(topic => {
      if (completedTopics.includes(topic._id) || inProgressTopics.includes(topic._id)) {
        return;
      }

      let score = 0;

      if (interestedCategories.includes(topic.category)) {
        score += 30;
      }

      const userLevel = progress?.stats?.level || 1;
      if (this.isAppropriateDifficulty(topic.difficulty, userLevel)) {
        score += 20;
      }

      if (score > 0) {
        recommendations.push({
          topicId: topic._id,
          title: topic.title,
          description: topic.description,
          category: topic.category,
          difficulty: topic.difficulty,
          estimatedTime: topic.duration,
          reason: {
            type: 'interest',
            description: 'Based on your interests and learning history',
            score
          },
          relevanceScore: score
        });
      }
    });

    return recommendations;
  }

  /**
   * Recommend topics based on quiz weaknesses
   */
  async recommendBasedOnWeaknesses(allTopics, quizHistory) {
    const recommendations = [];

    if (!quizHistory || !quizHistory.statistics.weakTopics) {
      return recommendations;
    }

    const weakTopics = quizHistory.statistics.weakTopics;

    weakTopics.forEach(weak => {
      const topic = allTopics.find(t => 
        t.title.toLowerCase().includes(weak.topic.toLowerCase())
      );

      if (topic) {
        recommendations.push({
          topicId: topic._id,
          title: topic.title,
          description: topic.description,
          category: topic.category,
          difficulty: topic.difficulty,
          estimatedTime: topic.duration,
          reason: {
            type: 'weakness',
            description: `You need more practice in ${weak.topic}`,
            score: 80 - (weak.averageScore || 50)
          },
          relevanceScore: 80 - (weak.averageScore || 50)
        });
      }
    });

    return recommendations;
  }

  /**
   * Recommend topics based on prerequisites
   */
  async recommendBasedOnPrerequisites(allTopics, progress) {
    const recommendations = [];
    
    const completedTopics = progress?.topicsProgress
      ?.filter(t => t.status === 'completed')
      .map(t => t.topicId) || [];

    allTopics.forEach(topic => {
      if (completedTopics.includes(topic._id)) return;

      if (topic.prerequisites && topic.prerequisites.length > 0) {
        const prerequisitesMet = topic.prerequisites.every(prereq => 
          completedTopics.includes(prereq.toString())
        );

        if (prerequisitesMet) {
          recommendations.push({
            topicId: topic._id,
            title: topic.title,
            description: topic.description,
            category: topic.category,
            difficulty: topic.difficulty,
            estimatedTime: topic.duration,
            reason: {
              type: 'prerequisite',
              description: 'You have completed all prerequisites for this topic',
              score: 70
            },
            relevanceScore: 70
          });
        }
      } else {
        recommendations.push({
          topicId: topic._id,
          title: topic.title,
          description: topic.description,
          category: topic.category,
          difficulty: topic.difficulty,
          estimatedTime: topic.duration,
          reason: {
            type: 'prerequisite',
            description: 'No prerequisites required',
            score: 50
          },
          relevanceScore: 50
        });
      }
    });

    return recommendations;
  }

  /**
   * Recommend topics based on mental state
   */
  async recommendBasedOnMentalState(allTopics, mentalState) {
    const recommendations = [];

    if (!mentalState) return recommendations;

    const { stressLevel, motivationLevel, energyLevel } = mentalState.currentState;

    let targetDifficulty = 'intermediate';
    let maxDuration = 60; 

    if (stressLevel === 'high' || energyLevel === 'low') {
      targetDifficulty = 'beginner';
      maxDuration = 30;
    } else if (motivationLevel === 'high' && energyLevel === 'high') {
      targetDifficulty = 'advanced';
      maxDuration = 90;
    }

    allTopics.forEach(topic => {
      if (topic.difficulty === targetDifficulty && topic.duration <= maxDuration) {
        recommendations.push({
          topicId: topic._id,
          title: topic.title,
          description: topic.description,
          category: topic.category,
          difficulty: topic.difficulty,
          estimatedTime: topic.duration,
          reason: {
            type: 'mental_state',
            description: `Recommended based on your current mental state`,
            score: 60
          },
          relevanceScore: 60
        });
      }
    });

    return recommendations;
  }

  /**
   * Get trending topics
   */
  async getTrendingTopics(allTopics) {
    const trending = await Topic.find({ isPublished: true })
      .sort({ enrolledStudents: -1 })
      .limit(10)
      .select('title description category difficulty duration enrolledStudents');

    return trending.map(topic => ({
      topicId: topic._id,
      title: topic.title,
      description: topic.description,
      category: topic.category,
      difficulty: topic.difficulty,
      estimatedTime: topic.duration,
      reason: {
        type: 'trending',
        description: `Popular with ${topic.enrolledStudents?.length || 0} other students`,
        score: 40 + Math.min(30, (topic.enrolledStudents?.length || 0) / 10)
      },
      relevanceScore: 40 + Math.min(30, (topic.enrolledStudents?.length || 0) / 10)
    }));
  }

  /**
   * Get categories user is interested in
   */
  async getInterestedCategories(allTopics, completedTopics) {
    const categories = {};
    
    completedTopics.forEach(topicId => {
      const topic = allTopics.find(t => t._id.toString() === topicId.toString());
      if (topic) {
        categories[topic.category] = (categories[topic.category] || 0) + 1;
      }
    });

    return Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category]) => category);
  }

  /**
   * Check if difficulty is appropriate for user level
   */
  isAppropriateDifficulty(difficulty, userLevel) {
    const difficultyLevel = {
      beginner: 1,
      intermediate: 2,
      advanced: 3
    };

    const topicLevel = difficultyLevel[difficulty] || 2;
    return Math.abs(topicLevel - userLevel) <= 1;
  }

  /**
   * Combine multiple recommendation lists
   */
  combineRecommendations(lists) {
    const combined = {};

    lists.forEach(recommendations => {
      recommendations.forEach(rec => {
        const id = rec.topicId.toString();
        if (!combined[id]) {
          combined[id] = rec;
        } else {
          combined[id].relevanceScore = (combined[id].relevanceScore + rec.relevanceScore) / 2;
          if (!Array.isArray(combined[id].reasons)) {
            combined[id].reasons = [combined[id].reason];
          }
          combined[id].reasons.push(rec.reason);
        }
      });
    });

    return Object.values(combined);
  }

  /**
   * Remove duplicate recommendations
   */
  removeDuplicates(recommendations) {
    const seen = new Set();
    return recommendations.filter(rec => {
      const id = rec.topicId.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  /**
   * Sort recommendations by relevance score
   */
  sortByRelevance(recommendations) {
    return recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Save recommendations to database
   */
  async saveRecommendations(studentId, recommendations) {
    let userRecommendations = await RecommendedTopics.findOne({ studentId });

    if (!userRecommendations) {
      userRecommendations = new RecommendedTopics({ studentId });
    }

    userRecommendations.recommendations = recommendations.map(rec => ({
      ...rec,
      status: 'recommended',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
    }));

    userRecommendations.categories = {
      forYou: recommendations.slice(0, 5).map(r => ({
        topicId: r.topicId,
        title: r.title,
        score: r.relevanceScore,
        reason: r.reason
      })),
      trending: recommendations.slice(0, 5),
      basedOnHistory: recommendations.slice(0, 5)
    };

    userRecommendations.lastGenerated = new Date();
    userRecommendations.generationMetadata = {
      method: 'hybrid',
      userDataPoints: 5,
      confidence: 85,
      processingTime: 0
    };

    await userRecommendations.save();
  }
}

// Export singleton instance
export default new RecommendationService();