import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdvisorLog from '../models/AdvisorLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.resolve(__dirname, '../logs');

if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    // ignore if cannot create
  }
}

const logFilePath = path.join(logsDir, 'metrics.jsonl');

/**
 * Record a trigger event
 */
export async function recordTrigger({ productId, sku, category, triggerType, advisor }) {
  const logEntry = {
    logType: 'TRIGGER_FIRED',
    timestamp: new Date(),
    productId,
    sku,
    category,
    triggerType,
    advisor
  };

  // 1. Structured log file
  try {
    fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('[Metrics] File log error:', err.message);
  }

  // 2. Queryable MongoDB persistence
  try {
    return await AdvisorLog.create(logEntry);
  } catch (err) {
    console.error('[Metrics] Mongo log error:', err.message);
    return null;
  }
}

/**
 * Record an AIAdvisor call outcome
 */
export async function recordAICall({
  productId,
  sku,
  category,
  triggerType,
  callType,
  outcome,
  latencyMs,
  fellBack,
  fallbackReason,
  inputDetails,
  outputDetails
}) {
  const logEntry = {
    logType: 'AI_CALL',
    timestamp: new Date(),
    productId,
    sku,
    category,
    triggerType,
    callType,
    outcome,
    latencyMs: Math.round(latencyMs * 100) / 100,
    fellBack: Boolean(fellBack),
    fallbackReason: fallbackReason || null,
    inputDetails: inputDetails || null,
    outputDetails: outputDetails || null
  };

  // 1. Structured log file
  try {
    fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('[Metrics] File log error:', err.message);
  }

  // 2. Queryable MongoDB persistence
  try {
    return await AdvisorLog.create(logEntry);
  } catch (err) {
    console.error('[Metrics] Mongo log error:', err.message);
    return null;
  }
}

/**
 * Aggregate metrics from MongoDB for reporting
 */
export async function getMetricsSummary(filter = {}) {
  const triggerLogs = await AdvisorLog.find({ logType: 'TRIGGER_FIRED', ...filter });
  const aiLogs = await AdvisorLog.find({ logType: 'AI_CALL', ...filter });

  const triggersByType = {};
  const triggersByAdvisor = {};
  for (const t of triggerLogs) {
    triggersByType[t.triggerType] = (triggersByType[t.triggerType] || 0) + 1;
    triggersByAdvisor[t.advisor] = (triggersByAdvisor[t.advisor] || 0) + 1;
  }

  const outcomes = {};
  let fallbackCount = 0;
  const latencies = [];

  for (const call of aiLogs) {
    outcomes[call.outcome] = (outcomes[call.outcome] || 0) + 1;
    if (call.fellBack) fallbackCount++;
    if (typeof call.latencyMs === 'number') latencies.push(call.latencyMs);
  }

  latencies.sort((a, b) => a - b);
  const totalCalls = aiLogs.length;

  const getPercentile = (p) => {
    if (latencies.length === 0) return 0;
    const index = Math.ceil((p / 100) * latencies.length) - 1;
    return latencies[Math.max(0, Math.min(index, latencies.length - 1))];
  };

  return {
    totalTriggers: triggerLogs.length,
    triggersByType,
    triggersByAdvisor,
    totalAICalls: totalCalls,
    outcomes,
    fallbackCount,
    fallbackRatePct: totalCalls > 0 ? ((fallbackCount / totalCalls) * 100).toFixed(2) : '0.00',
    latency: {
      count: latencies.length,
      minMs: latencies[0] || 0,
      medianMs: getPercentile(50),
      p90Ms: getPercentile(90),
      p95Ms: getPercentile(95),
      p99Ms: getPercentile(99),
      maxMs: latencies[latencies.length - 1] || 0
    }
  };
}
