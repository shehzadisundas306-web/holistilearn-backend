/**
 * AI Configuration
 * Centralized AI service settings
 */

import constants from './constants.js';

export default {
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.OPENAI_ORG_ID,
    
    models: {
      chat: 'gpt-4',
      quick: 'gpt-3.5-turbo'
    },
    
    defaultParams: {
      temperature: constants.AI.TEMPERATURE.NOTES,
      max_tokens: constants.AI.MAX_TOKENS.NOTES,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    },
    
    retryConfig: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 5000
    }
  },

  // Prompt Templates
  prompts: {
    notes: (topic, difficulty, mentalState) => `
      Create comprehensive study notes for "${topic}" at ${difficulty} level.
      
      Student's current mental state:
      - Mood: ${mentalState?.mood || 'neutral'}
      - Stress: ${mentalState?.stressLevel || 'medium'}
      - Motivation: ${mentalState?.motivationLevel || 'medium'}
      
      Adjust the tone accordingly:
      - If stressed: Use calming, encouraging language
      - If motivated: Include challenges and advanced concepts
      - If tired: Keep it concise with frequent breaks
      
      Structure the notes with:
      1. Clear overview/introduction
      2. 5-7 key points with detailed explanations
      3. Real-world examples and applications
      4. Code examples (if applicable)
      5. Common pitfalls to avoid
      6. Practice questions with answers
      7. Summary and key takeaways
      
      Make it engaging, easy to understand, and visually organized with clear sections.
    `,

    quiz: (topic, difficulty, numQuestions) => `
      Generate ${numQuestions} multiple choice questions about "${topic}" at ${difficulty} level.
      
      Return as a JSON array with this exact structure:
      [
        {
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A",
          "explanation": "Brief explanation of why this is correct",
          "difficulty": "${difficulty}",
          "topic": "${topic}",
          "points": 1
        }
      ]
      
      Requirements:
      - Questions should test understanding, not memorization
      - All options should be plausible
      - Explanations should help students learn from mistakes
      - Mix of easy, medium, and hard questions within the difficulty level
      - Include at least 2 questions with code snippets if applicable
    `,

    learningPath: (goal, currentLevel, mentalState) => `
      Create a personalized learning path for someone with goal: "${goal}" at ${currentLevel} level.
      
      Student's current mental state:
      - Stress: ${mentalState?.stressLevel || 'medium'}
      - Motivation: ${mentalState?.motivationLevel || 'medium'}
      - Energy: ${mentalState?.energyLevel || 'medium'}
      
      Return as JSON:
      {
        "milestones": [
          {
            "title": "Milestone name",
            "description": "What will be achieved",
            "topics": [
              {
                "name": "Topic name",
                "duration": "X hours",
                "resources": ["Resource 1", "Resource 2"],
                "skills": ["Skill 1", "Skill 2"]
              }
            ],
            "quizzes": ["Quiz 1", "Quiz 2"],
            "projects": ["Project idea"],
            "estimatedTime": "X days"
          }
        ],
        "totalDuration": "X weeks",
        "recommendedPace": "relaxed/moderate/intensive",
        "dailyCommitment": "X hours/day",
        "prerequisites": ["Prerequisite 1", "Prerequisite 2"],
        "careerOpportunities": ["Job 1", "Job 2"]
      }
      
      Adapt the pace based on mental state:
      - High stress: Relaxed pace with more breaks
      - High motivation: Intensive pace with challenges
      - Low energy: Moderate pace with energizing activities
    `,

    mentalHealthTip: (mentalState) => `
      Based on the student's current mental state:
      - Stress: ${mentalState.stressLevel}
      - Motivation: ${mentalState.motivationLevel}
      - Energy: ${mentalState.energyLevel}
      - Mood: ${mentalState.mood}
      
      Provide a personalized mental health tip and a quick 2-minute exercise they can do right now.
      Return as JSON:
      {
        "tip": "Brief mental health tip",
        "exercise": {
          "name": "Exercise name",
          "duration": "2 minutes",
          "steps": ["Step 1", "Step 2", "Step 3"],
          "benefits": ["Benefit 1", "Benefit 2"]
        },
        "affirmation": "Positive affirmation for today"
      }
    `,

    topicRecommendation: (quizHistory, mentalState) => `
      Based on:
      Quiz History: ${JSON.stringify(quizHistory)}
      Mental State: ${JSON.stringify(mentalState)}
      
      Recommend 3 topics the student should learn next.
      Return as JSON array:
      [
        {
          "topic": "Topic name",
          "reason": "Why this topic",
          "difficulty": "beginner/intermediate/advanced",
          "estimatedTime": "X hours",
          "prerequisites": ["Prerequisite 1"]
        }
      ]
    `
  },

  // Response Parsers
  parsers: {
    extractJSON: (text) => {
      try {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || 
                         text.match(/\{[\s\S]*\}/) || 
                         text.match(/\[[\s\S]*\]/);
        
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
        throw new Error('No valid JSON found');
      } catch (error) {
        console.error('Failed to parse AI response:', error);
        return null;
      }
    },

    extractCodeExamples: (text) => {
      const examples = [];
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
      
      let match;
      while ((match = codeBlockRegex.exec(text)) !== null) {
        examples.push({
          language: match[1] || 'text',
          code: match[2].trim()
        });
      }
      
      return examples;
    },

    extractKeyPoints: (text) => {
      const points = [];
      const lines = text.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.match(/^\d+\./)) {
          points.push(trimmed.replace(/^[-•\d.]\s*/, ''));
        }
      }
      
      return points;
    }
  },

  // Fallback Responses
  fallbacks: {
    quiz: (topic) => ({
      questions: [
        {
          question: `What is the main concept of ${topic}?`,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctAnswer: 'Option A',
          explanation: 'This is the fundamental concept you need to understand.',
          difficulty: 'beginner',
          points: 1
        }
      ]
    }),

    learningPath: (goal) => ({
      milestones: [
        {
          title: 'Fundamentals',
          description: 'Learn the basics',
          topics: [
            {
              name: 'Introduction',
              duration: '2 hours',
              resources: ['Official documentation', 'Video tutorials'],
              skills: ['Basic concepts']
            }
          ],
          quizzes: ['Basic Quiz'],
          projects: ['Simple project'],
          estimatedTime: '3 days'
        }
      ],
      totalDuration: '2 weeks',
      recommendedPace: 'moderate',
      dailyCommitment: '2 hours/day',
      prerequisites: ['Basic computer knowledge'],
      careerOpportunities: ['Junior Developer', 'Intern']
    })
  },

  // Rate Limiting for AI API
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 90000,
    concurrentRequests: 5
  },

  // Caching
  cache: {
    enabled: true,
    ttl: 3600, // 1 hour
    maxSize: 100 // Maximum cached items
  },

  // Monitoring
  monitoring: {
    logPrompts: process.env.NODE_ENV === 'development',
    logResponses: process.env.NODE_ENV === 'development',
    trackTokens: true,
    alertOnError: true
  }
};