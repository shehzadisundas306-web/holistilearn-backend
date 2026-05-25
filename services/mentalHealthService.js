/**
 * Mental Health Service
 * Handles analysis, trend tracking, and wellness recommendations for students
 */

import MentalState from '../models/MentalState.js';
import Activity from '../models/Activity.js';
import constants from '../config/constants.js';

class MentalHealthService {
  /**
   * Analyze mental health patterns and generate insights
   * @param {string} studentId - Student ID
   * @returns {Promise<Object>} Mental health analysis
   */
  async analyzeMentalHealth(studentId) {
    try {
      const mentalState = await MentalState.findOne({ studentId });
      
      if (!mentalState || mentalState.history.length < 3) {
        return {
          hasEnoughData: false,
          message: 'Not enough data for analysis. Please update your mental state regularly.'
        };
      }

      const analysis = {
        hasEnoughData: true,
        currentState: mentalState.currentState,
        trends: this.analyzeTrends(mentalState.history),
        patterns: this.identifyPatterns(mentalState.history),
        recommendations: this.generateRecommendations(mentalState),
        warnings: this.checkWarnings(mentalState.history),
        lastUpdated: mentalState.lastUpdated
      };

      return analysis;

    } catch (error) {
      console.error('Mental health analysis error:', error);
      throw error;
    }
  }

  /**
   * Analyze trends in mental state history
   * @param {Array} history - Mental state history
   * @returns {Object} Trend analysis
   */
  analyzeTrends(history) {
    if (history.length < 7) return {};

    const recent = history.slice(-7);
    const previous = history.slice(-14, -7);

    const calculateAverage = (entries, field) => {
      const values = entries.map(e => {
        if (field === 'stressLevel') {
          return e.stressLevel === 'high' ? 3 : e.stressLevel === 'medium' ? 2 : 1;
        }
        if (field === 'motivationLevel') {
          return e.motivationLevel === 'high' ? 3 : e.motivationLevel === 'medium' ? 2 : 1;
        }
        if (field === 'energyLevel') {
          return e.energyLevel === 'high' ? 3 : e.energyLevel === 'medium' ? 2 : 1;
        }
        return 2;
      });
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    const trends = {
      stress: this.calculateTrend(
        calculateAverage(previous, 'stressLevel'),
        calculateAverage(recent, 'stressLevel')
      ),
      motivation: this.calculateTrend(
        calculateAverage(previous, 'motivationLevel'),
        calculateAverage(recent, 'motivationLevel')
      ),
      energy: this.calculateTrend(
        calculateAverage(previous, 'energyLevel'),
        calculateAverage(recent, 'energyLevel')
      )
    };

    // Mood distribution
    const moodCounts = {};
    recent.forEach(entry => {
      moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
    });

    trends.dominantMood = Object.entries(moodCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

    return trends;
  }

  /**
   * Calculate trend direction
   * @param {number} previous - Previous value
   * @param {number} current - Current value
   * @returns {Object} Trend object
   */
  calculateTrend(previous, current) {
    const change = current - previous;
    const percentChange = previous > 0 ? (change / previous) * 100 : 0;

    let direction = 'stable';
    if (Math.abs(percentChange) > 10) {
      direction = percentChange > 0 ? 'increasing' : 'decreasing';
    }

    return {
      value: current,
      previous,
      change: change.toFixed(2),
      percentChange: percentChange.toFixed(1),
      direction
    };
  }

  /**
   * Identify patterns in mental state
   * @param {Array} history - Mental state history
   * @returns {Object} Pattern analysis
   */
  identifyPatterns(history) {
    if (history.length < 14) return {};

    const patterns = {};

    // Day of week patterns
    const dayPatterns = {};
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    history.forEach(entry => {
      const day = days[new Date(entry.date).getDay()];
      if (!dayPatterns[day]) {
        dayPatterns[day] = {
          count: 0,
          stress: 0,
          motivation: 0,
          energy: 0,
          moods: []
        };
      }

      dayPatterns[day].count++;
      dayPatterns[day].stress += entry.stressLevel === 'high' ? 3 : entry.stressLevel === 'medium' ? 2 : 1;
      dayPatterns[day].motivation += entry.motivationLevel === 'high' ? 3 : entry.motivationLevel === 'medium' ? 2 : 1;
      dayPatterns[day].energy += entry.energyLevel === 'high' ? 3 : entry.energyLevel === 'medium' ? 2 : 1;
      dayPatterns[day].moods.push(entry.mood);
    });

    patterns.bestDay = {
      day: this.findBestDay(dayPatterns),
      worstDay: this.findWorstDay(dayPatterns)
    };

    // Time of day patterns
    const timePatterns = {};
    history.forEach(entry => {
      const hour = new Date(entry.date).getHours();
      const timeSlot = this.getTimeSlot(hour);

      if (!timePatterns[timeSlot]) {
        timePatterns[timeSlot] = {
          count: 0,
          focus: 0,
          energy: 0
        };
      }

      timePatterns[timeSlot].count++;
      timePatterns[timeSlot].focus += entry.focusLevel === 'high' ? 3 : entry.focusLevel === 'medium' ? 2 : 1;
      timePatterns[timeSlot].energy += entry.energyLevel === 'high' ? 3 : entry.energyLevel === 'medium' ? 2 : 1;
    });

    patterns.bestTimeSlot = this.findBestTimeSlot(timePatterns);

    return patterns;
  }

  /**
   * Get time slot from hour
   */
  getTimeSlot(hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Find best day based on patterns
   */
  findBestDay(dayPatterns) {
    let bestDay = null;
    let bestScore = -1;

    Object.entries(dayPatterns).forEach(([day, data]) => {
      const avgStress = data.stress / data.count;
      const avgMotivation = data.motivation / data.count;
      const avgEnergy = data.energy / data.count;
      
      const score = (avgMotivation + avgEnergy) - avgStress;
      
      if (score > bestScore) {
        bestScore = score;
        bestDay = day;
      }
    });

    return bestDay;
  }

  /**
   * Find worst day based on patterns
   */
  findWorstDay(dayPatterns) {
    let worstDay = null;
    let worstScore = Infinity;

    Object.entries(dayPatterns).forEach(([day, data]) => {
      const avgStress = data.stress / data.count;
      const avgMotivation = data.motivation / data.count;
      const avgEnergy = data.energy / data.count;
      
      const score = avgStress - (avgMotivation + avgEnergy) / 2;
      
      if (score > worstScore) {
        worstScore = score;
        worstDay = day;
      }
    });

    return worstDay;
  }

  /**
   * Find best time slot
   */
  findBestTimeSlot(timePatterns) {
    let bestSlot = null;
    let bestScore = -1;

    Object.entries(timePatterns).forEach(([slot, data]) => {
      const avgFocus = data.focus / data.count;
      const avgEnergy = data.energy / data.count;
      
      const score = (avgFocus + avgEnergy) / 2;
      
      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    });

    return bestSlot;
  }

  /**
   * Generate recommendations based on mental state
   */
  generateRecommendations(mentalState) {
    const recommendations = [];
    const { currentState } = mentalState;

    if (currentState.stressLevel === 'high') {
      recommendations.push({
        type: 'break',
        priority: 'high',
        title: 'Take a Break',
        description: 'Your stress levels are high. Step away for 5-10 minutes.',
        action: 'Start Break Timer',
        duration: 5,
        icon: '🧘'
      });

      recommendations.push({
        type: 'exercise',
        priority: 'medium',
        title: 'Quick Relaxation',
        description: 'Try this 2-minute breathing exercise to calm your mind.',
        action: 'Start Exercise',
        steps: [
          'Inhale deeply for 4 counts',
          'Hold for 4 counts',
          'Exhale slowly for 6 counts',
          'Repeat 4 times'
        ],
        icon: '🌬️'
      });
    }

    if (currentState.motivationLevel === 'low') {
      recommendations.push({
        type: 'motivation',
        priority: 'high',
        title: 'Boost Your Motivation',
        description: 'Watch a success story or review your achievements.',
        action: 'View Achievements',
        icon: '💪'
      });

      recommendations.push({
        type: 'goal',
        priority: 'medium',
        title: 'Set Small Goals',
        description: 'Break down your tasks into smaller, achievable goals.',
        action: 'Set Goals',
        icon: '🎯'
      });
    }

    if (currentState.energyLevel === 'low') {
      recommendations.push({
        type: 'energy',
        priority: 'high',
        title: 'Energy Boost',
        description: 'Quick physical activity can help increase your energy.',
        action: 'Try Movement',
        exercises: [
          'Stand up and stretch',
          'Walk around for 2 minutes',
          'Do 10 jumping jacks',
          'Drink a glass of water'
        ],
        icon: '⚡'
      });
    }

    if (currentState.focusLevel === 'low') {
      recommendations.push({
        type: 'focus',
        priority: 'medium',
        title: 'Improve Focus',
        description: 'Try the Pomodoro technique: 25 minutes focus, 5 minutes break.',
        action: 'Start Pomodoro',
        icon: '🎯'
      });
    }

    if (currentState.mood === 'sad' || currentState.mood === 'anxious') {
      recommendations.push({
        type: 'wellness',
        priority: 'high',
        title: 'Self-Care Moment',
        description: 'Take time for yourself. Listen to calming music or meditate.',
        action: 'Start Meditation',
        icon: '🧠'
      });
    }

    return recommendations;
  }

  /**
   * Check for warnings in mental state
   */
  checkWarnings(history) {
    const warnings = [];
    const recent = history.slice(-7);

    if (recent.length < 3) return warnings;

    const highStressDays = recent.filter(d => d.stressLevel === 'high').length;
    if (highStressDays >= 5) {
      warnings.push({
        type: 'stress',
        severity: 'high',
        title: 'Prolonged High Stress',
        message: 'You\'ve been experiencing high stress for several days. Consider taking a break and practicing relaxation techniques.',
        icon: '⚠️'
      });
    }

    const lowMotivationDays = recent.filter(d => d.motivationLevel === 'low').length;
    if (lowMotivationDays >= 4) {
      warnings.push({
        type: 'motivation',
        severity: 'medium',
        title: 'Low Motivation Pattern',
        message: 'Your motivation has been consistently low. Try setting smaller, achievable goals.',
        icon: '📉'
      });
    }

    const lowSleepDays = recent.filter(d => d.sleepHours && d.sleepHours < 6).length;
    if (lowSleepDays >= 3) {
      warnings.push({
        type: 'sleep',
        severity: 'medium',
        title: 'Sleep Deprivation',
        message: 'You\'re not getting enough sleep. Aim for 7-9 hours for optimal learning.',
        icon: '😴'
      });
    }

    const moodTrend = this.analyzeMoodTrend(recent);
    if (moodTrend.declining) {
      warnings.push({
        type: 'mood',
        severity: 'medium',
        title: 'Declining Mood',
        message: 'Your mood has been declining. Consider talking to someone or taking a mental health day.',
        icon: '💭'
      });
    }

    return warnings;
  }

  /**
   * Analyze mood trend
   */
  analyzeMoodTrend(recent) {
    const moodScores = {
      happy: 5,
      energetic: 5,
      neutral: 3,
      tired: 2,
      sad: 1,
      anxious: 1
    };

    const scores = recent.map(d => moodScores[d.mood] || 3);
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return {
      declining: secondAvg < firstAvg - 0.5,
      improving: secondAvg > firstAvg + 0.5,
      stable: Math.abs(secondAvg - firstAvg) <= 0.5
    };
  }

  /**
   * Get wellness tip based on current state
   */
  getWellnessTip(currentState) {
    const tips = {
      high_stress: {
        title: "Manage Stress",
        tip: "When stress is high, your brain's learning capacity decreases. Take short breaks and practice deep breathing.",
        exercise: "4-7-8 Breathing: Inhale for 4 counts, hold for 7, exhale for 8. Repeat 3 times."
      },
      low_motivation: {
        title: "Build Momentum",
        tip: "Start with just 5 minutes of study. Often, getting started is the hardest part.",
        exercise: "List 3 things you want to accomplish today, no matter how small."
      },
      low_energy: {
        title: "Energy Boost",
        tip: "Physical movement increases blood flow to the brain. Stand up and move for 2 minutes.",
        exercise: "Do 10 jumping jacks, 5 squats, and stretch your arms overhead."
      },
      low_focus: {
        title: "Sharpen Focus",
        tip: "Try the Pomodoro Technique: 25 minutes of focused work, then 5 minutes break.",
        exercise: "Remove distractions, put phone away, and set a timer for 25 minutes."
      }
    };

    if (currentState.stressLevel === 'high') return tips.high_stress;
    if (currentState.motivationLevel === 'low') return tips.low_motivation;
    if (currentState.energyLevel === 'low') return tips.low_energy;
    if (currentState.focusLevel === 'low') return tips.low_focus;

    return {
      title: "Maintain Balance",
      tip: "You're doing great! Keep up your healthy habits.",
      exercise: "Take a moment to appreciate your progress today."
    };
  }

  /**
   * Calculate mental health score
   */
  calculateMentalHealthScore(currentState) {
    const scores = {
      stressLevel: { high: 20, medium: 50, low: 80 },
      motivationLevel: { high: 80, medium: 50, low: 20 },
      energyLevel: { high: 80, medium: 50, low: 20 },
      focusLevel: { high: 80, medium: 50, low: 20 },
      mood: { happy: 90, energetic: 85, neutral: 60, tired: 40, sad: 25, anxious: 20 }
    };

    let total = 0;
    let count = 0;

    if (currentState.stressLevel) {
      total += scores.stressLevel[currentState.stressLevel] || 50;
      count++;
    }
    if (currentState.motivationLevel) {
      total += scores.motivationLevel[currentState.motivationLevel] || 50;
      count++;
    }
    if (currentState.energyLevel) {
      total += scores.energyLevel[currentState.energyLevel] || 50;
      count++;
    }
    if (currentState.focusLevel) {
      total += scores.focusLevel[currentState.focusLevel] || 50;
      count++;
    }
    if (currentState.mood) {
      total += scores.mood[currentState.mood] || 50;
      count++;
    }

    return count > 0 ? Math.round(total / count) : 50;
  }
}

// Exporting a singleton instance
export default new MentalHealthService();