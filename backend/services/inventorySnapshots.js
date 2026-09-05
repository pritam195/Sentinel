import InventorySnapshot from '../models/InventorySnapshot.js';

export async function recordInventorySnapshot(product, source) {
  return InventorySnapshot.create({
    productId: product._id,
    stockLevel: product.stockLevel,
    demandVelocity: product.demandVelocity,
    source
  });
}
