import RuleBasedAdvisor from './RuleBasedAdvisor.js';
import NaiveRuleAdvisor from './NaiveRuleAdvisor.js';
import DaysOfSupplyRuleAdvisor from './DaysOfSupplyRuleAdvisor.js';
import AIAdvisor from './AIAdvisor.js';
import Config from '../models/Config.js';

// Strategy instances
const strategies = {
  'rule-based': new RuleBasedAdvisor(),
  'naive-rule': new NaiveRuleAdvisor(),
  'days-of-supply': new DaysOfSupplyRuleAdvisor(),
  'ai': new AIAdvisor()
};

/**
 * Extension Seam:
 * To add a new strategy (e.g., CompetitorAwareStrategy), 
 * simply instantiate it and add it to the `strategies` registry object above.
 * The calling code does not need to change.
 */

export async function getActiveStrategy() {
  let config = await Config.findOne();
  if (!config) {
    config = await Config.create({ activeStrategy: 'rule-based' });
  }
  
  const strategyName = config.activeStrategy;
  const strategy = strategies[strategyName];
  
  if (!strategy) {
    console.warn(`Strategy ${strategyName} not found, falling back to rule-based`);
    return strategies['rule-based'];
  }
  
  return strategy;
}
