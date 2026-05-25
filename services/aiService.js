// backend/services/aiService.js
// backend/services/aiService.js
import axios from "axios";

class AIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.baseUrl = "https://openrouter.ai/api/v1/chat/completions";
    
    // You can choose any model - these are good options:
    this.model = process.env.AI_MODEL || "mistralai/mistral-7b-instruct"; // Free tier
    // Other free options: "meta-llama/llama-3.2-3b-instruct:free", "microsoft/phi-3.5-mini-128k-instruct:free"
    
    this.maxRetries = 3;
    this.baseDelay = 2000;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000;
    
    console.log(`🤖 OpenRouter AI Service Initialized`);
    console.log(`📡 Model: ${this.model}`);
    console.log(`🔑 API Key exists: ${!!this.apiKey}`);
  }

  /* ================================
     CORE AI CALL WITH OPENROUTER
  ================================= */
  async callAI(prompt, { maxTokens = 2500, temperature = 0.7 } = {}, retryCount = 0) {
    try {
      // Check API key
      if (!this.apiKey) {
        console.error('❌ OPENROUTER_API_KEY is missing!');
        console.log('Get your key at: https://openrouter.ai/keys');
        throw new Error('OpenRouter API key is missing');
      }

      // Rate limiting
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minRequestInterval) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
        );
      }

      this.lastRequestTime = Date.now();

      console.log(`\n🤖 AI Call Attempt ${retryCount + 1}`);
      console.log(`📡 Model: ${this.model}`);
      console.log(`📝 Prompt length: ${prompt.length} chars`);

      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content: `You are an expert teacher. Return ONLY valid JSON. No markdown, no explanations outside JSON.`
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: temperature,
          max_tokens: maxTokens,
          top_p: 0.95,
          frequency_penalty: 0,
          presence_penalty: 0
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
            'X-Title': 'AI Study Assistant'
          },
          timeout: 60000
        }
      );

      const content = response.data.choices[0]?.message?.content || '';
      
      console.log("\n📥 RAW AI RESPONSE:\n", content.substring(0, 500));
      console.log("📊 Usage:", response.data.usage);

      const parsed = this.safeJSONParse(content);
      
      if (parsed.error) {
        console.warn("⚠️ JSON parse failed, using fallback");
        return this.getDetailedFallbackNotes(prompt.split("Topic:")[1]?.split("\n")[0]?.trim() || "topic");
      }
      
      return parsed;

    } catch (error) {
      console.error('❌ AI Call Error:', error.response?.data || error.message);
      
      // Handle rate limits
      if (error.response?.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        console.log(`⏳ Rate limit, retry in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callAI(prompt, { maxTokens, temperature }, retryCount + 1);
      }
      
      throw error;
    }
  }

  /* ================================
     IMPROVED JSON PARSING
  ================================= */
  safeJSONParse(text) {
    try {
      // Try direct parse first
      return JSON.parse(text);
    } catch (e1) {
      try {
        // Extract JSON from markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
      } catch (e2) {}

      try {
        // Extract JSON object from any text
        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          return JSON.parse(objectMatch[0]);
        }
      } catch (e3) {}

      try {
        // Try to extract array
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          return JSON.parse(arrayMatch[0]);
        }
      } catch (e4) {}

      console.warn("❌ Failed to parse JSON. Raw text preview:", text.substring(0, 200));
      return { error: true, raw: text };
    }
  }

  /* ================================
     NOTES GENERATION - STRICT JSON
  ================================= */
  async generateNotes({ topic, difficulty = "intermediate", includeExamples = true, includeQuestions = true, mentalState, customInstructions }) {
    try {
      console.log(`\n📝 Generating notes for: ${topic} (${difficulty})`);
      
//       const prompt = `
// You are an expert teacher creating detailed study notes.

// Topic: ${topic}
// Difficulty: ${difficulty}

// ${mentalState ? `Student mental state: ${JSON.stringify(mentalState)}` : ''}
// ${customInstructions ? `Additional instructions: ${customInstructions}` : ''}

// IMPORTANT RULES:
// - Return ONLY valid JSON
// - Do NOT include any text outside JSON
// - Do NOT use markdown
// - Do NOT say "Here are your notes"
// - Make content specific to ${topic}
// - Explanations must be detailed and practical
// - Include real-world examples

// STRICT FORMAT (must follow exactly):
// {
//   "overview": "2-3 sentence overview explaining why ${topic} matters",
//   "keyPoints": [
//     {
//       "point": "Concept name",
//       "explanation": "Detailed 2-3 sentence explanation with examples",
//       "importance": "high|medium|low"
//     }
//   ],
//   "detailedExplanation": {
//     "sections": [
//       {
//         "title": "Core Concepts",
//         "content": "Detailed explanation with practical examples"
//       },
//       {
//         "title": "Advanced Topics",
//         "content": "Deeper dive into advanced concepts"
//       }
//     ]
//   },
//   ${includeExamples ? `"codeExamples": [
//     {
//       "title": "Practical Example",
//       "language": "javascript",
//       "code": "// Working code example with comments",
//       "explanation": "Step-by-step explanation of what this code does"
//     }
//   ],` : ''}
//   ${includeQuestions ? `"practiceQuestions": [
//     {
//       "question": "Thought-provoking question",
//       "answer": "Detailed answer with explanation",
//       "hint": "Helpful hint to guide thinking"
//     }
//   ],` : ''}
//   "summary": "3-4 sentence summary of key takeaways"
// }`;


const prompt = `
You are a senior software engineer and expert teacher.

Your task is to generate HIGH-QUALITY, structured study notes.

----------------------
INPUT
----------------------
Topic: ${topic}
Difficulty: ${difficulty}
${mentalState ? `Student mental state: ${JSON.stringify(mentalState)}` : ''}
${customInstructions ? `Additional instructions: ${customInstructions}` : ''}

----------------------
STRICT RULES (MUST FOLLOW)
----------------------
1. Output ONLY valid JSON
2. DO NOT include markdown, explanations, or text outside JSON
3. DO NOT truncate the response
4. Ensure JSON is COMPLETE and properly closed
5. Keep total response under 1000 tokens
6. Use clear, structured, and concise explanations
7. Avoid generic textbook phrases
8. Include real-world examples where useful
9. Difficulty MUST match: ${difficulty}
10. Prefer depth over breadth
11. Include internal mechanics where relevant (e.g., event loop, memory, execution flow)

----------------------
OUTPUT FORMAT (EXACT)
----------------------

<JSON>
{
  "overview": "Clear 2-3 sentence explanation of ${topic} and why it matters",

  "keyPoints": [
    {
      "point": "Specific concept name",
      "explanation": "Detailed explanation with real-world context",
      "importance": "high"
    }
  ],

  "detailedExplanation": {
    "sections": [
      {
        "title": "Core Concepts",
        "content": "Explain fundamentals with examples and clarity"
      },
      {
        "title": "Advanced Insights",
        "content": "Explain deeper concepts, edge cases, or internal behavior"
      }
    ]
  },

  ${includeExamples ? `"codeExamples": [
    {
      "title": "Real Example",
      "language": "javascript",
      "code": "// Clean, working example with comments",
      "explanation": "Explain step-by-step what is happening and why"
    }
  ],` : ''}

  ${includeQuestions ? `"practiceQuestions": [
    {
      "question": "Conceptual question testing understanding",
      "answer": "Clear explanation of the correct answer",
      "hint": "Helpful hint"
    }
  ],` : ''}

  "summary": "Concise summary focusing on key takeaways"
}
</JSON>

----------------------
FINAL INSTRUCTION
----------------------
Return ONLY the JSON inside <JSON> tags.
Ensure the JSON is COMPLETE and VALID.
`;
      const data = await this.callAI(prompt, { maxTokens: 3000, temperature: 0.7 });
      
      if (data.error) {
        console.warn('⚠️ AI returned error, using fallback');
        return this.getDetailedFallbackNotes(topic);
      }
      
      const validated = this.validateNotes(data, topic);
      console.log(`✅ Notes generated successfully for "${topic}"`);
      return validated;
      
    } catch (error) {
      console.error('❌ Notes Generation Error:', error.message);
      return this.getDetailedFallbackNotes(topic);
    }
  }

  /* ================================
     VALIDATE NOTES STRUCTURE
  ================================= */
  validateNotes(notes, topic) {
    return {
      overview: notes.overview || `A comprehensive guide to ${topic}.`,
      keyPoints: Array.isArray(notes.keyPoints) && notes.keyPoints.length > 0 
        ? notes.keyPoints 
        : this.getDefaultKeyPoints(topic),
      detailedExplanation: notes.detailedExplanation || {
        sections: [
          { title: `Introduction to ${topic}`, content: `Learn the core concepts of ${topic}.` },
          { title: `Practical Applications`, content: `How to apply ${topic} in real-world scenarios.` }
        ]
      },
      codeExamples: notes.codeExamples || [],
      practiceQuestions: notes.practiceQuestions || [],
      summary: notes.summary || `Mastering ${topic} opens new opportunities. Keep practicing!`
    };
  }

  getDefaultKeyPoints(topic) {
    return [
      {
        point: `Fundamentals of ${topic}`,
        explanation: `Understanding the core principles of ${topic} is essential for mastering advanced concepts. Start with the basics and build your knowledge progressively.`,
        importance: "high"
      },
      {
        point: `Practical Applications`,
        explanation: `${topic} is widely used in real-world scenarios across various industries. Learning to apply these concepts practically will accelerate your understanding.`,
        importance: "high"
      },
      {
        point: `Best Practices`,
        explanation: `Following established patterns and best practices ensures your ${topic} implementation is maintainable, scalable, and efficient.`,
        importance: "medium"
      }
    ];
  }

  /* ================================
     DETAILED FALLBACK (Topic-Specific)
  ================================= */
  getDetailedFallbackNotes(topic) {
    const lowerTopic = topic.toLowerCase();
    
    // JavaScript specific content
    if (lowerTopic.includes('javascript') || lowerTopic.includes('js')) {
      return {
        overview: "JavaScript is a high-level, interpreted programming language that enables interactive web pages. It's one of the core technologies of the web alongside HTML and CSS.",
        keyPoints: [
          { point: "Variables and Data Types", explanation: "JavaScript uses var, let, const for declarations. Types include String, Number, Boolean, Object, Array, Function, and Symbol.", importance: "high" },
          { point: "Functions and Scope", explanation: "Functions are first-class objects. JavaScript has function scope (var) and block scope (let, const).", importance: "high" },
          { point: "Asynchronous Programming", explanation: "Handles async operations through callbacks, Promises, and async/await patterns for non-blocking code.", importance: "high" }
        ],
        detailedExplanation: {
          sections: [
            { title: "JavaScript Runtime", content: "JavaScript runs in the browser and Node.js environments. It's single-threaded but handles async operations efficiently." },
            { title: "Execution Context", content: "Every JavaScript code runs in an execution context. Understanding hoisting, closures, and the event loop is crucial." }
          ]
        },
        codeExamples: [
          {
            title: "Async/Await Example",
            language: "javascript",
            code: `async function fetchData() {\n  try {\n    const response = await fetch('https://api.example.com/data');\n    const data = await response.json();\n    return data;\n  } catch (error) {\n    console.error('Error:', error);\n  }\n}`,
            explanation: "Async/await provides a cleaner way to handle promises. The function pauses execution until the promise resolves."
          }
        ],
        practiceQuestions: [
          { question: "What is closure in JavaScript?", answer: "A closure is the combination of a function bundled together with references to its surrounding state.", hint: "Think about function inside function." },
          { question: "Explain the event loop.", answer: "The event loop allows JavaScript to perform non-blocking operations despite being single-threaded.", hint: "It handles async operations." }
        ],
        summary: "JavaScript is essential for modern web development. Master variables, functions, DOM manipulation, and async patterns to build interactive applications."
      };
    }
    
    // Node.js specific content
    if (lowerTopic.includes('node')) {
      return {
        overview: "Node.js is a JavaScript runtime built on Chrome's V8 engine that allows developers to run JavaScript on the server side. It's designed for building scalable network applications.",
        keyPoints: [
          { point: "Event-Driven Architecture", explanation: "Node.js uses an event-driven, non-blocking I/O model. Events are emitted and handled by callbacks.", importance: "high" },
          { point: "NPM (Node Package Manager)", explanation: "NPM is the world's largest software registry with over 1.3 million packages.", importance: "high" },
          { point: "CommonJS Modules", explanation: "Node.js uses CommonJS modules. Each file is treated as a separate module.", importance: "high" }
        ],
        detailedExplanation: {
          sections: [
            { title: "The Event Loop", content: "Node.js uses a single-threaded event loop to handle asynchronous operations efficiently." },
            { title: "The libuv Library", content: "libuv is a multi-platform C library that provides asynchronous I/O operations." }
          ]
        },
        codeExamples: [
          {
            title: "Simple HTTP Server",
            language: "javascript",
            code: `const http = require('http');\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/plain' });\n  res.end('Hello World!\\n');\n});\n\nserver.listen(3000, () => {\n  console.log('Server running at http://localhost:3000/');\n});`,
            explanation: "This creates a basic HTTP server that responds with 'Hello World!' to every request."
          }
        ],
        practiceQuestions: [
          { question: "What is the event loop in Node.js?", answer: "The event loop is a mechanism that handles asynchronous operations in Node.js.", hint: "It's what makes Node.js asynchronous." }
        ],
        summary: "Node.js enables JavaScript on the server side. Master the event loop, NPM, and modules to build scalable network applications."
      };
    }

    // Generic fallback
    return {
      overview: `${topic} is an important subject in modern technology. This comprehensive guide covers the essential concepts you need to understand.`,
      keyPoints: [
        { point: `Understanding ${topic} Fundamentals`, explanation: `The core principles of ${topic} provide the foundation for advanced topics.`, importance: "high" },
        { point: `Practical Applications`, explanation: `${topic} has numerous real-world applications across various industries.`, importance: "high" },
        { point: `Best Practices`, explanation: `Following industry best practices ensures your ${topic} implementations are maintainable.`, importance: "medium" }
      ],
      detailedExplanation: {
        sections: [
          { title: `Introduction to ${topic}`, content: `${topic} is a foundational concept that builds upon previous knowledge.` },
          { title: `Core Principles`, content: `The fundamental principles of ${topic} include understanding its building blocks and how they interact.` }
        ]
      },
      codeExamples: [],
      practiceQuestions: [
        { question: `What are the key benefits of learning ${topic}?`, answer: `Learning ${topic} provides valuable skills across various domains.`, hint: `Think about career impact.` }
      ],
      summary: `Mastering ${topic} takes time and practice. Continue building projects to solidify your understanding.`
    };
  }

  /* ================================
     QUIZ GENERATION
  ================================= */
  async generateQuiz({ topic, difficulty = "medium", numQuestions = 5 }) {
    try {
      const prompt = `
Topic: ${topic}
Difficulty: ${difficulty}

Generate ${numQuestions} multiple choice questions.

Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "Clear question",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A",
      "explanation": "Why this is correct"
    }
  ]
}`;

      const data = await this.callAI(prompt, { maxTokens: 2500, temperature: 0.8 });
      
      if (data.error || !data.questions) {
        return this.getFallbackQuiz(topic);
      }
      
      return data;
    } catch (error) {
      return this.getFallbackQuiz(topic);
    }
  }

  getFallbackQuiz(topic) {
    return {
      questions: [
        {
          question: `What is the main concept of ${topic}?`,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctAnswer: 'Option A',
          explanation: `This is the fundamental concept in ${topic}.`
        }
      ]
    };
  }

  /* ================================
     LEARNING PATH GENERATION
  ================================= */
  async generateLearningPath({ goal, currentLevel = "beginner" }) {
    try {
      const prompt = `
Goal: ${goal}
Current Level: ${currentLevel}

Create a structured learning path.

Return ONLY valid JSON:
{
  "goal": "string",
  "description": "string",
  "difficulty": "beginner|intermediate|advanced",
  "milestones": [
    {
      "title": "string",
      "topics": ["topic1", "topic2"],
      "estimatedTime": "X weeks"
    }
  ]
}`;

      const data = await this.callAI(prompt, { maxTokens: 2000, temperature: 0.7 });
      
      if (data.error) {
        return {
          goal: goal,
          description: `A structured path to master ${goal}`,
          difficulty: "intermediate",
          milestones: [
            { title: "Fundamentals", topics: ["Introduction", "Core Concepts"], estimatedTime: "2 weeks" }
          ]
        };
      }
      
      return data;
    } catch (error) {
      return {
        goal: goal,
        description: `Learn ${goal} step by step`,
        difficulty: "intermediate",
        milestones: []
      };
    }
  }

  /* ================================
     RECOMMENDATIONS
  ================================= */
  async recommendTopics({ interests = [] }) {
    try {
      const prompt = `
Interests: ${interests.join(", ")}

Recommend 5 topics to learn next.

Return ONLY valid JSON array:
[
  {
    "topic": "string",
    "difficulty": "beginner|intermediate|advanced",
    "reason": "string"
  }
]`;

      const data = await this.callAI(prompt, { maxTokens: 1500, temperature: 0.7 });
      
      if (data.error || !Array.isArray(data)) {
        return [
          { topic: "JavaScript Fundamentals", difficulty: "beginner", reason: "Essential for web development" },
          { topic: "React Basics", difficulty: "intermediate", reason: "Popular framework" }
        ];
      }
      
      return data;
    } catch (error) {
      return [];
    }
  }

  // backend/services/aiService.js - Add this new method

  /* ================================
     AI TOPIC DISCOVERY (NEW)
  ================================= */
  async discoverTopics({ query, difficulty, goal, mentalState, weakTopics = [] }) {
    try {
      console.log(`\n🔍 AI Discovering topics for: "${query}"`);
      
      const difficultyHint = difficulty ? `Difficulty preference: ${difficulty}` : 'Any difficulty level';
      const goalHint = goal ? `Learning goal: ${goal}` : 'General learning';
      const weakHint = weakTopics.length > 0 ? `Student struggles with: ${weakTopics.join(', ')}` : '';
      const mentalHint = mentalState ? `Student mental state: stress=${mentalState.stressLevel}, mood=${mentalState.mood}` : '';
      
      const prompt = `You are an expert curriculum designer and learning path creator.

STUDENT CONTEXT:
- Wants to learn: "${query}"
- ${difficultyHint}
- ${goalHint}
${weakHint ? `- ${weakHint}` : ''}
${mentalHint ? `- ${mentalHint}` : ''}

IMPORTANT RULES:
1. Generate 5 specific, actionable subtopics related to "${query}"
2. If student is stressed (stress=high), suggest easier/shorter topics
3. If student has weak areas, suggest topics that address those gaps
4. Each topic must be a complete, learnable unit
5. Return ONLY valid JSON - no markdown, no extra text

STRICT OUTPUT FORMAT (JSON array):
[
  {
    "title": "Specific topic title (e.g., 'React Hooks: useState Explained')",
    "description": "What the student will learn in 2-3 sentences. Be specific and actionable.",
    "difficulty": "beginner|intermediate|advanced",
    "estimatedTime": "X hours",
    "skills": ["skill1", "skill2", "skill3"],
    "whyRecommended": "Brief reason why this topic is recommended for this student"
  }
]`;

      const data = await this.callAI(prompt, { maxTokens: 2500, temperature: 0.7 });
      
      if (data.error || !Array.isArray(data)) {
        console.warn('⚠️ AI topic discovery failed, using fallback');
        return this.getFallbackTopics(query);
      }
      
      // Validate and clean AI response
      const validatedTopics = data.slice(0, 5).map(topic => ({
        title: topic.title || `${query} - Topic`,
        description: topic.description || `Learn about ${topic.title || query} comprehensively.`,
        difficulty: this.validateDifficulty(topic.difficulty),
        estimatedTime: topic.estimatedTime || this.estimateTimeByDifficulty(topic.difficulty),
        skills: Array.isArray(topic.skills) ? topic.skills.slice(0, 5) : [`${query} Fundamentals`],
        whyRecommended: topic.whyRecommended || `Based on your interest in ${query}`,
        isAIGenerated: true
      }));
      
      console.log(`✅ AI generated ${validatedTopics.length} topics for "${query}"`);
      return validatedTopics;
      
    } catch (error) {
      console.error('❌ AI Topic Discovery Error:', error.message);
      return this.getFallbackTopics(query);
    }
  }

  validateDifficulty(difficulty) {
    const valid = ['beginner', 'intermediate', 'advanced'];
    return valid.includes(difficulty?.toLowerCase()) ? difficulty.toLowerCase() : 'intermediate';
  }

  estimateTimeByDifficulty(difficulty) {
    switch(difficulty?.toLowerCase()) {
      case 'beginner': return '2-3 hours';
      case 'intermediate': return '4-6 hours';
      case 'advanced': return '8-10 hours';
      default: return '3-5 hours';
    }
  }

  getFallbackTopics(query) {
    return [
      {
        title: `Introduction to ${query}`,
        description: `Learn the fundamental concepts and core principles of ${query}. Perfect for beginners.`,
        difficulty: 'beginner',
        estimatedTime: '2-3 hours',
        skills: [`${query} Basics`, 'Core Concepts'],
        whyRecommended: `Essential foundation for understanding ${query}`,
        isAIGenerated: true
      },
      {
        title: `${query} Best Practices`,
        description: `Master industry best practices and common patterns in ${query}.`,
        difficulty: 'intermediate',
        estimatedTime: '4-5 hours',
        skills: [`Advanced ${query}`, 'Best Practices'],
        whyRecommended: `Take your ${query} skills to the next level`,
        isAIGenerated: true
      },
      {
        title: `Real-World ${query} Projects`,
        description: `Apply your ${query} knowledge to build practical, real-world projects.`,
        difficulty: 'intermediate',
        estimatedTime: '6-8 hours',
        skills: ['Project Building', 'Problem Solving'],
        whyRecommended: `Build a portfolio with practical ${query} projects`,
        isAIGenerated: true
      }
    ];
  }
}

export default new AIService();