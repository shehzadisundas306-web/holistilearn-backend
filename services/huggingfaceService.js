// backend/services/huggingfaceService.js
import axios from 'axios';

class HuggingFaceService {
  constructor() {
    this.apiKey = process.env.HUGGINGFACE_API_KEY;
    this.apiUrl = "https://api-inference.huggingface.co/models/";
    this.models = {
      // For text generation (tips, recommendations)
      textGen: "microsoft/DialoGPT-medium",
      // For sentiment analysis (mood detection)
      sentiment: "cardiffnlp/twitter-roberta-base-sentiment-latest",
      // For text classification (mental health analysis)
      classifier: "ProsusAI/finbert",
      // For generating affirmations
      affirmations: "gpt2"
    };
    
    console.log('🤗 Hugging Face AI Service Initialized');
  }

  /**
   * Call Hugging Face API
   */
  async callHuggingFace(model, inputs, options = {}) {
    try {
      const response = await axios.post(
        `${this.apiUrl}${model}`,
        { inputs, options },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      return response.data;
    } catch (error) {
      console.error(`HuggingFace API Error (${model}):`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Generate personalized wellness tip based on mental state
   */
  async generateWellnessTip(mentalState) {
    const { mood, stressLevel, motivationLevel, energyLevel } = mentalState;
    
    const prompt = `Based on the following mental state:
- Mood: ${mood}
- Stress: ${stressLevel}
- Motivation: ${motivationLevel}
- Energy: ${energyLevel}

Generate a short, encouraging wellness tip (max 50 words) that helps improve well-being.`;

    const result = await this.callHuggingFace(this.models.textGen, prompt, {
      max_length: 100,
      temperature: 0.7
    });
    
    if (result && result[0]?.generated_text) {
      return result[0].generated_text.replace(prompt, '').trim();
    }
    
    return this.getFallbackWellnessTip(mentalState);
  }

  /**
   * Analyze sentiment from journal entry
   */
  async analyzeSentiment(text) {
    const result = await this.callHuggingFace(this.models.sentiment, text);
    
    if (result) {
      // Parse sentiment result
      const sentiment = result[0];
      return {
        label: sentiment.label,
        score: sentiment.score,
        analysis: sentiment.label === 'positive' ? 'positive' : 
                  sentiment.label === 'negative' ? 'negative' : 'neutral'
      };
    }
    
    return { label: 'neutral', score: 0.5, analysis: 'neutral' };
  }

  /**
   * Generate personalized affirmation based on mood
   */
  async generateAffirmation(mood) {
    const prompt = `Generate a positive affirmation for someone feeling ${mood}. The affirmation should be encouraging and uplifting.`;
    
    const result = await this.callHuggingFace(this.models.affirmations, prompt, {
      max_length: 80,
      temperature: 0.8
    });
    
    if (result && result[0]?.generated_text) {
      return result[0].generated_text.replace(prompt, '').trim();
    }
    
    return this.getFallbackAffirmation(mood);
  }

  /**
   * Get fallback wellness tip
   */
  getFallbackWellnessTip(mentalState) {
    const tips = {
      high_stress: "Take a deep breath. Try the 4-7-8 breathing technique: inhale for 4 seconds, hold for 7, exhale for 8.",
      low_motivation: "Start with just 5 minutes of work. Often, getting started is the hardest part.",
      low_energy: "Stand up and stretch for 2 minutes. Movement increases blood flow and energy levels.",
      sad_mood: "Write down three things you're grateful for today. Gratitude boosts happiness.",
      anxious_mood: "Ground yourself by naming 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, and 1 you can taste."
    };
    
    if (mentalState.stressLevel === 'high') return tips.high_stress;
    if (mentalState.motivationLevel === 'low') return tips.low_motivation;
    if (mentalState.energyLevel === 'low') return tips.low_energy;
    if (mentalState.mood === 'sad') return tips.sad_mood;
    if (mentalState.mood === 'anxious') return tips.anxious_mood;
    
    return "Take a moment for yourself today. You're doing great!";
  }

  /**
   * Get fallback affirmation
   */
  getFallbackAffirmation(mood) {
    const affirmations = {
      happy: "Your positive energy is contagious! Keep spreading joy.",
      neutral: "You are capable of amazing things. Today is full of potential.",
      sad: "This feeling will pass. You are strong and resilient.",
      anxious: "You have handled challenges before. You can handle this one too.",
      tired: "Rest is productive. Taking care of yourself is important.",
      energetic: "Your energy is powerful! Channel it into something meaningful."
    };
    
    return affirmations[mood] || "You are enough, just as you are.";
  }
}

export default new HuggingFaceService();