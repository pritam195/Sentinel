import mongoose from 'mongoose';

/**
 * AUDIT INTEGRITY SPECIFICATION:
 * InventorySnapshot provides an append-only audit trail for inventory signals feeding the advisor loop.
 *
 * ENFORCEMENT LEVEL:
 * This constraint is enforced at the APPLICATION LEVEL via Mongoose pre-hooks below.
 * It is NOT database-enforced by MongoDB itself; direct database drivers, administrative scripts,
 * or raw shell commands with write privileges can bypass these application hooks.
 *
 * TO ENFORCE AT THE DATABASE LEVEL IN PRODUCTION MONGODB:
 * Configure a custom MongoDB role granting only 'find' and 'insert' privileges on this collection:
 * ```javascript
 * db.createRole({
 *   role: "appendOnlyAuditRole",
 *   privileges: [
 *     { resource: { db: "sentinel", collection: "inventorysnapshots" }, actions: [ "find", "insert" ] },
 *     { resource: { db: "sentinel", collection: "advisorlogs" }, actions: [ "find", "insert" ] }
 *   ],
 *   roles: []
 * });
 * db.grantRolesToUser("sentinel_app_user", ["appendOnlyAuditRole"]);
 * ```
 */

const inventorySnapshotSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  stockLevel: { type: Number, required: true, min: 0 },
  demandVelocity: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['CREATED', 'STOCK_UPDATED', 'ORDER', 'REORDER_ACCEPTED'], required: true },
  actedBy: { type: String, required: false, default: null }
}, { timestamps: true });

const disallowMutation = function () {
  const options = this.getOptions ? this.getOptions() : {};
  if (options && options.bypassAuditGuard === true) return;
  throw new Error('InventorySnapshot is append-only: updates and deletes are disallowed at the application level.');
};

// Query middleware disallowing update and delete operations
inventorySnapshotSchema.pre('updateOne', disallowMutation);
inventorySnapshotSchema.pre('updateMany', disallowMutation);
inventorySnapshotSchema.pre('deleteOne', disallowMutation);
inventorySnapshotSchema.pre('deleteMany', disallowMutation);
inventorySnapshotSchema.pre('findOneAndUpdate', disallowMutation);
inventorySnapshotSchema.pre('findOneAndDelete', disallowMutation);
inventorySnapshotSchema.pre('findOneAndReplace', disallowMutation);
inventorySnapshotSchema.pre('replaceOne', disallowMutation);

// Document middleware disallowing update on existing documents
inventorySnapshotSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('InventorySnapshot is append-only: document updates are disallowed at the application level.');
  }
});

export default mongoose.model('InventorySnapshot', inventorySnapshotSchema);
