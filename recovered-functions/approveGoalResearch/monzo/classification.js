const admin = require('firebase-admin');
const functionsV2 = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { callLLMJson } = require('../utils/llm');
const { recordAiLog } = require('../utils/logging');
const crypto = require('crypto');

const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');

async function classifyMonzoTransaction({ transaction, llmClient, userId }) {
  if (!transaction) return null;
  if (transaction.provider !== 'monzo') return null;
  if (transaction.userCategoryType) return null;

  const amount = Number(transaction.amount || 0) / 100;
  const currency = transaction.currency || 'GBP';
  const merchantName = transaction.merchant?.name || transaction.merchant?.merchant_name || 'N/A';
  const description = transaction.description || transaction.merchant?.metadata?.name || 'Monzo transaction';

  const systemPrompt =
    'You are a financial assistant. Categorise the given transaction. ' +
    'Return JSON: {"categoryType":"mandatory|optional|savings|income","categoryLabel":string,"confidence":0-1,"reason":string}';

  const userPrompt =
    `Transaction description: "${description}"\n` +
    `Amount: ${amount.toFixed(2)} ${currency}\n` +
    `Merchant: ${merchantName}\n` +
    `Notes: ${transaction.notes || transaction.memo || 'n/a'}`;

  const model = 'gemini-1.5-flash';
  const raw = await llmClient({
    system: systemPrompt,
    user: userPrompt,
    purpose: 'monzoTransactionClassification',
    userId,
    expectJson: true,
    temperature: 0.1,
    model,
  });

  const responseHash = crypto.createHash('sha256').update(raw || '').digest('hex');
  let parsed = {};
  try {
    parsed = JSON.parse(raw || '{}');
  } catch (error) {
    parsed = {};
  }

  const categoryType = typeof parsed.categoryType === 'string' ? parsed.categoryType.trim() : null;
  const categoryLabel = typeof parsed.categoryLabel === 'string' ? parsed.categoryLabel.trim() : null;
  const confidence = Number(parsed.confidence);
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null;

  if (!categoryType || !categoryLabel) return null;

  return {
    categoryType,
    categoryLabel,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    reason,
    prompt: { systemPrompt, userPrompt },
    model,
    responseHash,
  };
}
async function handleTransactionClassification(snap) {
  if (!snap) return;
  const transaction = snap.data() || {};
  const uid = transaction.ownerUid || transaction.userId;
  if (!uid) return;
  if (transaction.userCategoryType) return;
  if (transaction.aiCategoryType) return;

  try {
    const result = await classifyMonzoTransaction({
      transaction,
      llmClient: callLLMJson,
      userId: uid,
    });

    if (!result) return;

    await snap.ref.set(
      {
        aiCategoryType: result.categoryType,
        aiCategoryLabel: result.categoryLabel,
        aiCategorizedAt: admin.firestore.FieldValue.serverTimestamp(),
        aiCategoryConfidence: result.confidence ?? null,
        aiCategoryReason: result.reason || null,
        aiCategoryPrompt: result.prompt || null,
        aiCategoryModel: result.model,
        aiCategoryResponseHash: result.responseHash,
        aiCategorySource: 'llm',
      },
      { merge: true }
    );

    await recordAiLog(uid, 'monzoTransactionClassification', 'success', 'Transaction categorized by AI', {
      transactionId: snap.id,
      categoryType: result.categoryType,
      categoryLabel: result.categoryLabel,
      confidence: result.confidence ?? null,
      model: result.model,
      prompt: result.prompt,
      responseHash: result.responseHash,
    });
  } catch (error) {
    await recordAiLog(uid, 'monzoTransactionClassification', 'error', 'Failed to categorize transaction by AI', {
      transactionId: snap.id,
      error: error?.message || String(error),
    });
  }
}

const onFinanceTransactionCreated = functionsV2.firestore.onDocumentCreated(
  'finance_transactions/{transactionId}',
  { secrets: [GOOGLE_AI_STUDIO_API_KEY] },
  async (event) => {
    await handleTransactionClassification(event.data);
  }
);

const onMonzoTransactionCreated = functionsV2.firestore.onDocumentCreated(
  'monzo_transactions/{transactionId}',
  { secrets: [GOOGLE_AI_STUDIO_API_KEY] },
  async (event) => {
    await handleTransactionClassification(event.data);
  }
);

module.exports = {
  onFinanceTransactionCreated,
  onMonzoTransactionCreated,
  classifyMonzoTransaction,
};
