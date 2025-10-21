// AI Usage Logger - Comprehensive tracking for LLM and AI service usage
const admin = require('firebase-admin');

/**
 * AI Usage Logger for BOB v3.5.7
 * Comprehensive tracking of AI API usage, token consumption, and costs
 */
class AIUsageLogger {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  // Lazy initialization of Firebase
  initialize() {
    if (!this.initialized) {
      try {
        // Check if admin app is already initialized
        this.app = admin.apps.length > 0 ? admin.app() : admin.initializeApp();
        this.db = admin.firestore();
        this.initialized = true;
      } catch (error) {
        console.error('AIUsageLogger initialization error:', error);
        // Continue without database logging in case of initialization failure
        this.initialized = false;
      }
    }
  }

  /**
   * Log AI usage with comprehensive tracking
   */
  async logUsage({
    service,
    model,
    functionName,
    promptTokens,
    completionTokens,
    totalTokens,
    requestId,
    latency,
    cost,
    status = 'success',
    errorMessage = null,
    userId = null,
    persona = null,
    context = {}
  }) {
    this.initialize();
    
    if (!this.initialized || !this.db) {
      console.warn('AIUsageLogger: Database not initialized, skipping log');
      return;
    }

    try {
      const logEntry = {
        service,
        model,
        functionName,
        promptTokens: promptTokens || 0,
        completionTokens: completionTokens || 0,
        totalTokens: totalTokens || (promptTokens || 0) + (completionTokens || 0),
        requestId,
        latency,
        cost: typeof cost === 'number'
          ? cost
          : this.estimateCost(service, model, {
              prompt_tokens: promptTokens || 0,
              completion_tokens: completionTokens || 0,
            }),
        status,
        errorMessage,
        userId,
        persona,
        context,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        date: new Date().toISOString().split('T')[0] // YYYY-MM-DD format
      };

      // Log to ai_usage_logs collection
      await this.db.collection('ai_usage_logs').add(logEntry);
      
      // Update daily aggregates
      await this.updateDailyAggregates(logEntry);
      
      console.log(`✅ AI Usage logged: ${service}/${model} - ${totalTokens || 0} tokens - $${logEntry.cost.toFixed(4)}`);
    } catch (error) {
      console.error('Error logging AI usage:', error);
    }
  }

  /**
   * Update daily aggregates for dashboard performance
   */
  async updateDailyAggregates(logEntry) {
    try {
      const date = logEntry.date;
      const aggregateRef = this.db.collection('ai_usage_aggregates').doc(date);
      
      await aggregateRef.set({
        date,
        totalRequests: admin.firestore.FieldValue.increment(1),
        totalTokens: admin.firestore.FieldValue.increment(logEntry.totalTokens || 0),
        totalCostUSD: admin.firestore.FieldValue.increment(logEntry.cost || 0),
        avgLatencyMs: logEntry.latency || 0, // Simple overwrite; refine to rolling average if needed
        
        // Service breakdowns
        byService: {
          [logEntry.service]: {
            requests: admin.firestore.FieldValue.increment(1),
            tokens: admin.firestore.FieldValue.increment(logEntry.totalTokens || 0),
            costUSD: admin.firestore.FieldValue.increment(logEntry.cost || 0)
          }
        },
        
        // Model breakdowns
        byModel: {
          [logEntry.model]: {
            requests: admin.firestore.FieldValue.increment(1),
            tokens: admin.firestore.FieldValue.increment(logEntry.totalTokens || 0),
            costUSD: admin.firestore.FieldValue.increment(logEntry.cost || 0)
          }
        },
        
        // Function breakdowns
        byFunction: {
          [logEntry.functionName]: {
            requests: admin.firestore.FieldValue.increment(1),
            tokens: admin.firestore.FieldValue.increment(logEntry.totalTokens || 0),
            costUSD: admin.firestore.FieldValue.increment(logEntry.cost || 0)
          }
        },
        
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('❌ Failed to update daily aggregates:', error);
    }
  }

  /**
   * Estimate cost based on service and model
   */
  estimateCost(aiService, model, usage) {
    if (!usage) return 0;
    
    // Gemini pricing (approximate; adjust as needed)
    const pricing = {
      gemini: {
        'gemini-flash': {
          prompt: 0.00015 / 1000,   // Estimated
          completion: 0.0006 / 1000
        }
      }
    };
    
    const modelPricing = pricing[aiService]?.[model];
    if (!modelPricing) return 0;
    
    const promptCost = (usage.prompt_tokens || 0) * modelPricing.prompt;
    const completionCost = (usage.completion_tokens || 0) * modelPricing.completion;
    
    return promptCost + completionCost;
  }

  estimatePromptCost(aiService, model, promptTokens) {
    return this.estimateCost(aiService, model, { prompt_tokens: promptTokens, completion_tokens: 0 });
  }

  estimateCompletionCost(aiService, model, completionTokens) {
    return this.estimateCost(aiService, model, { prompt_tokens: 0, completion_tokens: completionTokens });
  }

  /**
   * Helper methods
   */
  getSystemPromptLength(messages) {
    return messages?.find(m => m.role === 'system')?.content?.length || 0;
  }

  getUserPromptLength(messages) {
    return messages?.filter(m => m.role === 'user')
      .reduce((total, m) => total + (m.content?.length || 0), 0) || 0;
  }

  countWords(text) {
    return text ? text.trim().split(/\s+/).length : 0;
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a wrapper for AI calls that automatically logs usage
   */
  wrapAICall(service, model) {
    this.initialize();
    
    return async (originalCall, context = {}) => {
      const requestId = this.generateRequestId();
      const startTime = Date.now();
      
      try {
        const result = await originalCall();
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        // Extract usage info from result
        const usage = result?.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || promptTokens + completionTokens;
        
        await this.logUsage({
          service,
          model,
          functionName: context.functionName || 'unknown',
          promptTokens,
          completionTokens,
          totalTokens,
          requestId,
          latency,
          status: 'success',
          userId: context.userId,
          persona: context.persona,
          context: {
            purpose: context.purpose,
            metadata: context.metadata,
            request: context.request,
            response: {
              choices: result?.choices?.length || 0,
              finish_reason: result?.choices?.[0]?.finish_reason
            }
          }
        });
        
        return result;
      } catch (error) {
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        // Log failed attempts too
        await this.logUsage({
          service,
          model,
          functionName: context.functionName || 'unknown',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requestId,
          latency,
          status: 'error',
          errorMessage: error.message,
          userId: context.userId,
          persona: context.persona,
          context: {
            purpose: context.purpose,
            metadata: context.metadata,
            request: context.request,
            error: error.message
          }
        });
        
        throw error;
      }
    };
  }
}

module.exports = new AIUsageLogger();
