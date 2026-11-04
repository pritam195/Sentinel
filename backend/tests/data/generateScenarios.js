import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to round to 2 decimals
const r2 = (n) => Math.round(n * 100) / 100;

const CATEGORIES = [
  { name: 'ELECTRONICS', avgVel: 3.5, prefix: 'ELEC' },
  { name: 'APPAREL', avgVel: 3.0, prefix: 'APP' },
  { name: 'HOME', avgVel: 2.5, prefix: 'HOME' },
  { name: 'BEAUTY', avgVel: 4.0, prefix: 'BEAU' },
  { name: 'GROCERY', avgVel: 5.5, prefix: 'GROC' }
];

const ARCHETYPES = [
  // 1: Critical Stock & Surge Demand
  {
    type: 'CRITICAL_STOCK_SURGE',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.15, // stock / threshold
    threshold: 20,
    velMult: 4.5,
    costRatio: 0.55,
    dir: 'INCREASE',
    priceMarkup: 0.12,
    priceTol: [0.08, 0.16],
    reorderDays: 21,
    rationale: 'Critical stock buffer (<20% of threshold) combined with 4-5x velocity surge demands aggressive scarcity rationing and rapid replenishment.'
  },
  // 2: Severe Overstock / Dead Inventory
  {
    type: 'SEVERE_OVERSTOCK',
    trigger: 'MANUAL',
    stockFactor: 6.0,
    threshold: 25,
    velMult: 0.25,
    costRatio: 0.40,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.15, 0.0],
    reorderDays: 0,
    minQty: 0,
    maxQty: 5,
    rationale: 'Heavy inventory overhang (>6x threshold) with stagnant run-rate; price must hold or discount, zero urgent reorder.'
  },
  // 3: Massive Viral Demand Surge (8x-12x)
  {
    type: 'VIRAL_DEMAND_SURGE',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 1.8,
    threshold: 25,
    velMult: 9.0,
    costRatio: 0.45,
    dir: 'INCREASE',
    priceMarkup: 0.10,
    priceTol: [0.05, 0.14],
    reorderDays: 14,
    rationale: 'Extreme demand spike (9x category average); high consumer willingness to pay allows a 10% price capture while scaling purchase order.'
  },
  // 4: Low Stock, Steady Velocity
  {
    type: 'LOW_STOCK_STEADY',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.55,
    threshold: 20,
    velMult: 1.1,
    costRatio: 0.60,
    dir: 'INCREASE',
    priceMarkup: 0.08,
    priceTol: [0.04, 0.12],
    reorderDays: 18,
    rationale: 'Inventory below threshold with steady baseline velocity; modest price bump to extend days of supply until arrival.'
  },
  // 5: Complete Stockout / Zero Stock
  {
    type: 'ZERO_STOCKOUT',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.0,
    threshold: 20,
    velMult: 2.0,
    costRatio: 0.50,
    dir: 'INCREASE',
    priceMarkup: 0.10,
    priceTol: [0.05, 0.15],
    reorderDays: 25,
    rationale: 'Zero units on hand; raise price to moderate backorder inflow and initiate urgent replenishment order.'
  },
  // 6: Balanced Equilibrium
  {
    type: 'EQUILIBRIUM',
    trigger: 'MANUAL',
    stockFactor: 2.2,
    threshold: 20,
    velMult: 1.0,
    costRatio: 0.50,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.03, 0.03],
    reorderDays: 7,
    rationale: 'Stock coverage and velocity align with category norms; maintain price stability to avoid friction.'
  },
  // 7: Razor-Thin Margin (Near Cost)
  {
    type: 'RAZOR_THIN_MARGIN',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.40,
    threshold: 20,
    velMult: 1.2,
    costRatio: 0.92, // 8% gross margin
    dir: 'INCREASE',
    priceMarkup: 0.06,
    priceTol: [0.03, 0.10],
    reorderDays: 16,
    rationale: 'Tight margin product near unit cost; price increase protects against cost inflation and inventory loss.'
  },
  // 8: Sudden Mid-Tier Surge
  {
    type: 'MID_TIER_SURGE',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 1.2,
    threshold: 20,
    velMult: 3.8,
    costRatio: 0.50,
    dir: 'INCREASE',
    priceMarkup: 0.07,
    priceTol: [0.04, 0.10],
    reorderDays: 18,
    rationale: 'Velocity nearly 4x category average; harvest demand premium with +7% adjustment.'
  },
  // 9: Seasonal Acceleration
  {
    type: 'SEASONAL_ACCELERATION',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 0.9,
    threshold: 25,
    velMult: 3.2,
    costRatio: 0.48,
    dir: 'INCREASE',
    priceMarkup: 0.08,
    priceTol: [0.04, 0.12],
    reorderDays: 20,
    rationale: 'Rising seasonal velocity meeting thinning inventory; price increase preserves remaining units.'
  },
  // 10: Near-Depletion Stockout Alert
  {
    type: 'NEAR_DEPLETION',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.10,
    threshold: 20,
    velMult: 2.2,
    costRatio: 0.55,
    dir: 'INCREASE',
    priceMarkup: 0.12,
    priceTol: [0.08, 0.15],
    reorderDays: 24,
    rationale: 'Only 2 units remaining against rapid sales; aggressive price defense required.'
  },
  // 11: Modest Low Stock
  {
    type: 'MODEST_LOW_STOCK',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.65,
    threshold: 20,
    velMult: 1.0,
    costRatio: 0.52,
    dir: 'INCREASE',
    priceMarkup: 0.06,
    priceTol: [0.03, 0.10],
    reorderDays: 15,
    rationale: 'Slightly below replenishment trigger; standard cautionary +6% markup.'
  },
  // 12: Steady Replenishment Equilibrium
  {
    type: 'STEADY_REPLENISHMENT',
    trigger: 'MANUAL',
    stockFactor: 1.6,
    threshold: 20,
    velMult: 1.05,
    costRatio: 0.50,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.03, 0.03],
    reorderDays: 8,
    rationale: 'Predictable recurring turnover; steady pricing maximizes customer retention.'
  },
  // 13: High-Ticket Surge
  {
    type: 'HIGH_TICKET_SURGE',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 1.1,
    threshold: 15,
    velMult: 2.9,
    costRatio: 0.60,
    dir: 'INCREASE',
    priceMarkup: 0.05,
    priceTol: [0.03, 0.08],
    reorderDays: 18,
    rationale: 'Premium unit with 3x velocity increase; conservative 5% markup preserves unit sales while expanding dollar margin.'
  },
  // 14: Moderate Overstock
  {
    type: 'MODERATE_OVERSTOCK',
    trigger: 'MANUAL',
    stockFactor: 3.5,
    threshold: 20,
    velMult: 0.6,
    costRatio: 0.45,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.10, 0.0],
    reorderDays: 0,
    minQty: 0,
    maxQty: 10,
    rationale: 'Inventory coverage exceeds 60 days; hold price firm, no immediate replenishment.'
  },
  // 15: Ultra Luxury Margin Cushion
  {
    type: 'LUXURY_MARGIN_CUSHION',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.40,
    threshold: 15,
    velMult: 1.4,
    costRatio: 0.20, // 80% margin
    dir: 'INCREASE',
    priceMarkup: 0.10,
    priceTol: [0.06, 0.15],
    reorderDays: 20,
    rationale: 'High brand equity and luxury margins; price elasticity supports strong scarcity pricing.'
  },
  // 16: High-Volume Staple Equilibrium
  {
    type: 'HIGH_VOLUME_STAPLE',
    trigger: 'MANUAL',
    stockFactor: 2.5,
    threshold: 30,
    velMult: 1.8,
    costRatio: 0.55,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.03, 0.03],
    reorderDays: 10,
    rationale: 'Core everyday staple with strong volume; maintain reliable benchmark price point.'
  },
  // 17: Near-Cost Floor Stress Test
  {
    type: 'NEAR_COST_STRESS',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.35,
    threshold: 25,
    velMult: 1.0,
    costRatio: 0.94, // 6% gross margin
    dir: 'INCREASE',
    priceMarkup: 0.05,
    priceTol: [0.02, 0.08],
    reorderDays: 18,
    rationale: 'Extreme margin compression; upward adjustment is necessary to avoid margin loss.'
  },
  // 18: Zero Stockout with High Viral Spike
  {
    type: 'ZERO_STOCK_VIRAL_SPIKE',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 0.0,
    threshold: 20,
    velMult: 8.5,
    costRatio: 0.50,
    dir: 'INCREASE',
    priceMarkup: 0.12,
    priceTol: [0.08, 0.18],
    reorderDays: 28,
    rationale: 'Stock completely exhausted while viral demand is peak; premium pricing on pre-orders and massive replenishment.'
  },
  // 19: Trending Demand Wave
  {
    type: 'TRENDING_DEMAND_WAVE',
    trigger: 'DEMAND_SPIKE',
    stockFactor: 1.4,
    threshold: 20,
    velMult: 3.5,
    costRatio: 0.45,
    dir: 'INCREASE',
    priceMarkup: 0.06,
    priceTol: [0.03, 0.10],
    reorderDays: 16,
    rationale: 'Healthy velocity surge with modest buffer; capture demand momentum.'
  },
  // 20: Dead Stock Overhang (Extreme Overstock)
  {
    type: 'DEAD_STOCK_OVERHANG',
    trigger: 'MANUAL',
    stockFactor: 8.0,
    threshold: 20,
    velMult: 0.1,
    costRatio: 0.35,
    dir: 'HOLD',
    priceMarkup: 0.0,
    priceTol: [-0.20, 0.0],
    reorderDays: 0,
    minQty: 0,
    maxQty: 2,
    rationale: 'Extreme dead stock (>8x threshold); zero replenishment, hold or promotional discount.'
  },
  // 21: Critical Stockout & Strong Velocity
  {
    type: 'CRITICAL_STOCKOUT_STRONG_VEL',
    trigger: 'INVENTORY_LOW',
    stockFactor: 0.20,
    threshold: 20,
    velMult: 3.0,
    costRatio: 0.50,
    dir: 'INCREASE',
    priceMarkup: 0.11,
    priceTol: [0.07, 0.15],
    reorderDays: 22,
    rationale: 'Severe inventory pinch with 3x category run-rate; strong rationing markup.'
  }
];

// Product name banks per category
const PRODUCT_NAMES = {
  ELECTRONICS: [
    'Wireless ANC Over-Ear Headphones',
    'Braided 100W USB-C Fast Cable',
    'Multi-Port GaN Wall Charger 65W',
    'RGB Mechanical Gaming Keyboard',
    'Action Cam 4K Waterproof Ultra',
    'Portable Bluetooth Speaker IPX7',
    'Ergonomic Optical Wireless Mouse',
    'Slim 20,000mAh Power Bank USB-C',
    'Dual-Band Wi-Fi 6 Mesh Router',
    'Noise-Canceling Studio Microphone',
    'Magnetic Wireless Car Charger Mount',
    '4K DisplayPort to HDMI Adapter',
    'Curved Gaming Monitor 32-inch 165Hz',
    'High-Speed MicroSDXC Card 256GB',
    'Smart Watch GPS Fitness Tracker',
    'Surge Protector 12-Outlet Strip',
    'Wireless Earbuds with Charging Case',
    'External NVMe SSD Enclosure 10Gbps',
    'Smart Home Wi-Fi Security Camera',
    'Universal Laptop Docking Station',
    'USB Condenser Streaming Microphone'
  ],
  APPAREL: [
    'Merino Wool Crewneck Sweater',
    'Quick-Dry Athletic Running Shorts',
    'Heavyweight Cotton Graphic Tee',
    'Waterproof Hooded Rain Parka',
    'Raw Denim Slim-Fit Jeans',
    'Breathable Mesh Walking Sneakers',
    'Performance Thermal Compression Top',
    'Fleece-Lined Winter Beanie Hat',
    'Packable Down Puffer Jacket',
    'Linen Button-Down Resort Shirt',
    'Ankle Athletic Socks (6-Pack)',
    'Stretch Chino Everyday Trousers',
    'Seamless High-Waisted Yoga Leggings',
    'Classic Leather Dress Belt',
    'Water-Resistant Commuter Backpack',
    'Moisture-Wicking Polo Shirt',
    'Insulated Ski Gloves Touchscreen',
    'Organic Bamboo Boxer Briefs (3-Pack)',
    'Polarized Aviator Sunglasses',
    'Ribbed Knit Infinity Scarf',
    'Canvas Slip-On Deck Shoes'
  ],
  HOME: [
    'Ceramic Pour-Over Coffee Dripper',
    'Ultrasonic Cool Mist Aroma Diffuser',
    'Bamboo Cutting Board with Groove',
    'Stainless Steel Thermal Tumbler 30oz',
    'Egyptian Cotton Sheet Set Queen',
    'Cast Iron Pre-Seasoned Skillet 12-in',
    'Non-Slip Memory Foam Bath Mat',
    'Double-Walled Glass Coffee Mugs',
    'Electric Gooseneck Drip Kettle',
    'Linen Textured Blackout Curtains',
    'Soy Candle Sandalwood & Amber',
    'Silicone Kitchen Cooking Utensils',
    'Stackable Food Storage Containers',
    'Minimalist Modern Ceramic Table Lamp',
    'Microfiber Dish Drying Mat Set',
    'Heavy-Duty Stainless Chef Knife 8-in',
    'Over-the-Sink Roll-Up Dish Rack',
    'Weighted Blanket 15lbs Breathable',
    'Glass Food Prep Storage Jars',
    'Modern Decorative Wall Clock',
    'Natural Jute Area Rug 5x7'
  ],
  BEAUTY: [
    'Hyaluronic Acid Hydrating Serum',
    'Broad Spectrum SPF 50 Facial Sunscreen',
    'Niacinamide Pore Refining Essence',
    'Volumizing Biotin Hair Shampoo',
    'Gentle Foaming Daily Facial Cleanser',
    'Shea Butter Deep Repair Body Cream',
    'Vitamin C Brightening Eye Treatment',
    'Retinol Night Renewal Cream 0.5%',
    'Rose Water Balancing Facial Toner',
    'Argan Oil Leave-In Hair Treatment',
    'Exfoliating Salicylic Acid Scrub',
    'Hydrating Tinted Lip Balm SPF 15',
    'Collagen Firming Sheet Mask (5-Pack)',
    'Mineral Loose Setting Powder',
    'Waterproof Long-Wear Liquid Eyeliner',
    'Detangling Wet Hair Brush',
    'Ceramide Barrier Repair Moisturizer',
    'Matte Velvet Liquid Lipstick',
    'Tea Tree Clarifying Spot Gel',
    'Peptide Restorative Hand Salve',
    'Clay Detox Purifying Face Mask'
  ],
  GROCERY: [
    'Organic Extra Virgin Olive Oil 1L',
    'Fair Trade Single Origin Whole Coffee',
    'Raw Organic Clover Honey 16oz',
    'Artisanal Sourdough Crackers Box',
    'Cold-Pressed Unsweetened Almond Milk',
    'Gluten-Free Rolled Oats 32oz Bag',
    'All-Natural Creamy Peanut Butter 28oz',
    'Sparkling Mineral Water (12-Pack)',
    'Organic Quinoa Grain Ancient Seeds',
    'Dark Chocolate Almond Sea Salt Bar',
    'Aged Balsamic Vinegar of Modena',
    'Non-GMO Chickpeas Garbanzo (4-Pack)',
    'Pure Maple Syrup Grade A Amber 32oz',
    'Whole Grain Brown Rice Jasmine 5lb',
    'Matcha Green Tea Powder Ceremonial',
    'Raw Unsalted California Walnuts 16oz',
    'Pink Himalayan Fine Mineral Salt',
    'Organic Marinara Tomato Sauce 24oz',
    'Wild Alaskan Smoked Salmon Jerky',
    'Organic Apple Cider Vinegar Raw',
    'Chia Seeds Omega-3 Rich 16oz'
  ]
};

// Base price targets per category
const BASE_PRICES = {
  ELECTRONICS: [199.99, 19.99, 54.99, 129.99, 299.99, 69.99, 29.99, 44.99, 89.99, 119.99, 34.99, 16.99, 349.99, 24.99, 179.99, 22.99, 59.99, 39.99, 79.99, 149.99, 89.99],
  APPAREL: [88.00, 36.00, 28.00, 145.00, 98.00, 75.00, 42.00, 26.00, 160.00, 72.00, 18.00, 68.00, 54.00, 35.00, 95.00, 48.00, 45.00, 32.00, 65.00, 24.00, 50.00],
  HOME: [45.00, 34.99, 24.99, 29.99, 110.00, 49.99, 22.00, 28.00, 65.00, 58.00, 22.50, 27.00, 36.00, 55.00, 14.99, 79.00, 19.99, 85.00, 25.00, 38.00, 120.00],
  BEAUTY: [32.00, 24.50, 28.00, 22.00, 18.50, 26.00, 42.00, 58.00, 21.00, 29.00, 16.50, 12.00, 15.00, 34.00, 19.00, 14.00, 38.00, 24.00, 17.50, 18.00, 25.00],
  GROCERY: [18.99, 16.49, 12.99, 6.49, 4.99, 7.99, 8.49, 14.99, 6.99, 4.49, 15.99, 8.99, 21.99, 11.49, 26.99, 12.49, 5.99, 7.49, 11.99, 6.99, 9.49]
};

const scenarios = [];
let scenarioId = 1;

for (let catIdx = 0; catIdx < CATEGORIES.length; catIdx++) {
  const cat = CATEGORIES[catIdx];
  const names = PRODUCT_NAMES[cat.name];
  const prices = BASE_PRICES[cat.name];

  for (let archIdx = 0; archIdx < ARCHETYPES.length; archIdx++) {
    const arch = ARCHETYPES[archIdx];
    const name = names[archIdx];
    const currentPrice = prices[archIdx];
    const costPrice = r2(currentPrice * arch.costRatio);

    const reorderThreshold = arch.threshold;
    const stockLevel = Math.round(reorderThreshold * arch.stockFactor);
    const demandVelocity = r2(cat.avgVel * arch.velMult);

    // Compute expected price and bounds
    let expectedPrice = r2(currentPrice * (1 + arch.priceMarkup));
    let minPrice = r2(currentPrice * (1 + arch.priceTol[0]));
    let maxPrice = r2(currentPrice * (1 + arch.priceTol[1]));

    if (arch.dir === 'HOLD') {
      expectedPrice = currentPrice;
      minPrice = r2(currentPrice * (1 + arch.priceTol[0]));
      maxPrice = r2(currentPrice * (1 + arch.priceTol[1]));
    }

    // Floor protection clamp
    const floor = r2(Math.max(costPrice * 1.05, currentPrice * 0.5));
    if (expectedPrice < floor) expectedPrice = floor;
    if (minPrice < floor) minPrice = floor;
    if (maxPrice < minPrice) maxPrice = r2(minPrice * 1.05);

    // Reorder quantity computation
    let expectedQty = 0;
    let minQty = 0;
    let maxQty = 0;

    if (arch.reorderDays === 0) {
      expectedQty = arch.minQty ?? 0;
      minQty = arch.minQty ?? 0;
      maxQty = arch.maxQty ?? 5;
    } else {
      const targetSupply = Math.round(demandVelocity * arch.reorderDays);
      expectedQty = Math.max(reorderThreshold, targetSupply - stockLevel);
      minQty = Math.max(1, Math.round(expectedQty * 0.70));
      maxQty = Math.round(expectedQty * 1.45);
    }

    scenarios.push({
      id: scenarioId++,
      name: `${name} — ${arch.type.replace(/_/g, ' ')}`,
      category: cat.name,
      currentPrice,
      costPrice,
      stockLevel,
      reorderThreshold,
      demandVelocity,
      categoryAverageVelocity: cat.avgVel,
      triggerReason: arch.trigger,
      expert: {
        direction: arch.dir,
        expectedPrice,
        minPrice,
        maxPrice,
        expectedQty,
        minQty,
        maxQty,
        rationale: arch.rationale
      }
    });
  }
}

const outputPath = path.join(__dirname, 'benchmarkScenarios.js');
const fileContent = `/**
 * Sentinel 105 Benchmark Ground-Truth Merchandising Scenarios
 * Evaluated across 5 Commercial Categories:
 * ELECTRONICS (1-21), APPAREL (22-42), HOME (43-63), BEAUTY (64-84), GROCERY (85-105)
 *
 * Subject to Human Expert Review per docs/benchmark-labeling.md.
 */

export const benchmarkScenarios = ${JSON.stringify(scenarios, null, 2)};
export default benchmarkScenarios;
`;

fs.writeFileSync(outputPath, fileContent, 'utf8');
console.log(`Successfully generated ${scenarios.length} scenarios into ${outputPath}`);
