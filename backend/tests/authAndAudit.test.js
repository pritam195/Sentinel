import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { signToken, JWT_SECRET, ROLES } from '../middleware/auth.js';
import suggestionRoutes from '../routes/suggestions.js';
import configRoutes from '../routes/config.js';
import authRoutes from '../routes/auth.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import AdvisorLog from '../models/AdvisorLog.js';
import User, { seedDefaultUsers } from '../models/User.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

// Create test express app
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/', suggestionRoutes);
app.use('/config', configRoutes);

export async function runAuthAndAuditTests() {
  console.log('===============================================================');
  console.log('          SENTINEL AUTH & AUDIT INTEGRITY TEST HARNESS         ');
  console.log('===============================================================');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  await seedDefaultUsers();

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Helper to make real HTTP requests to the test server
  async function callRoute(method, path, body = {}, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  }

  try {
    // Setup test product and suggestions
    await Product.deleteMany({ sku: { $regex: /^AUTH-/ } });
    const testProduct = await Product.create({
      sku: 'AUTH-TEST-SKU-A-' + Date.now(),
      name: 'Auth Protected Camera A',
      category: 'ELECTRONICS',
      currentPrice: 400.00,
      costPrice: 200.00,
      stockLevel: 10,
      reorderThreshold: 20,
      demandVelocity: 2
    });

    const reorderProduct = await Product.create({
      sku: 'AUTH-TEST-SKU-B-' + Date.now(),
      name: 'Auth Protected Camera B',
      category: 'ELECTRONICS',
      currentPrice: 300.00,
      costPrice: 150.00,
      stockLevel: 10,
      reorderThreshold: 20,
      demandVelocity: 2
    });

    const testPricing = await PricingSuggestion.create({
      productId: testProduct._id,
      currentPrice: 400.00,
      recommendedPrice: 440.00,
      direction: 'INCREASE',
      confidence: 0.85,
      reasoning: 'Protect scarce inventory',
      status: 'PENDING',
      triggerReason: 'INVENTORY_LOW',
      priceVersion: testProduct.priceVersion || 1,
      expiresAt: new Date(Date.now() + 86400000)
    });

    const testReorder = await ReorderSuggestion.create({
      productId: reorderProduct._id,
      currentStock: 10,
      stockAtGeneration: 10,
      recommendedQuantity: 30,
      suggestedLeadTimeDays: 7,
      confidence: 0.8,
      reasoning: 'Stock replenishment',
      status: 'PENDING',
      triggerReason: 'INVENTORY_LOW',
      expiresAt: new Date(Date.now() + 86400000)
    });

    // 1. Unauthenticated & Invalid Token Requests
    console.log('\n1. TESTING UNAUTHENTICATED & INVALID TOKEN REQUESTS (401 UNAUTHORIZED)...');
    
    // 1.1 No token
    const noTokenRes = await callRoute('PATCH', `/pricing-suggestions/${testPricing._id}`, { status: 'ACCEPTED' });
    assert(noTokenRes.status === 401, `PATCH without token returns 401 (got ${noTokenRes.status})`);
    assert(noTokenRes.data.error.includes('required'), 'Error indicates token is required');

    // 1.2 Expired token
    const expiredToken = signToken(
      { userId: 'usr_admin_01', role: ROLES.ADMIN, name: 'Admin Root' },
      { expiresIn: '-10s' }
    );
    const expiredTokenRes = await callRoute('PATCH', `/pricing-suggestions/${testPricing._id}`, { status: 'ACCEPTED' }, expiredToken);
    assert(expiredTokenRes.status === 401, `PATCH with expired token returns 401 (got ${expiredTokenRes.status})`);
    assert(expiredTokenRes.data.error.toLowerCase().includes('expired'), 'Error message indicates token is expired');

    // 1.3 Tampered token (modified payload with original signature)
    const validToken = signToken({ userId: 'usr_viewer_99', role: ROLES.VIEWER, name: 'Viewer Bob' });
    const parts = validToken.split('.');
    // Tamper the payload segment (change role to ADMIN)
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'usr_viewer_99', role: 'ADMIN', name: 'Viewer Bob' })).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const tamperedRes = await callRoute('PATCH', `/pricing-suggestions/${testPricing._id}`, { status: 'ACCEPTED' }, tamperedToken);
    assert(tamperedRes.status === 401, `PATCH with tampered token returns 401 (got ${tamperedRes.status})`);
    assert(tamperedRes.data.error.includes('Invalid or expired'), 'Error indicates token is invalid/tampered');

    // 2. Authentication Flow & Role Lookup on POST /auth/login
    console.log('\n2. TESTING AUTHENTICATION FLOW & SERVER-SIDE ROLE LOOKUP...');
    
    // 2.1 Valid merchandiser login
    const merchLoginRes = await callRoute('POST', '/auth/login', {
      username: 'merchandiser',
      password: 'merchpassword123'
    });
    assert(merchLoginRes.status === 200, `POST /auth/login succeeds with status 200`);
    assert(merchLoginRes.data.token !== undefined, 'Returns signed JWT token');
    assert(merchLoginRes.data.user.role === ROLES.MERCHANDISER, `Server looked up role: got ${merchLoginRes.data.user.role}`);
    const merchToken = merchLoginRes.data.token;

    // 2.2 Attempt role escalation through request body (merchandiser trying to pass role: 'ADMIN')
    const escalateRes = await callRoute('POST', '/auth/login', {
      username: 'merchandiser',
      password: 'merchpassword123',
      role: 'ADMIN' // Malicious attempt to escalate role
    });
    assert(escalateRes.status === 200, 'Login request processed');
    assert(escalateRes.data.user.role === ROLES.MERCHANDISER, 'Role escalation in request body rejected; server kept role MERCHANDISER');
    const decodedEscalated = jwt.decode(escalateRes.data.token);
    assert(decodedEscalated.role === ROLES.MERCHANDISER, 'Signed JWT payload role is MERCHANDISER, not ADMIN');

    // 2.3 Invalid credentials
    const badPassRes = await callRoute('POST', '/auth/login', {
      username: 'merchandiser',
      password: 'wrongpassword'
    });
    assert(badPassRes.status === 401, `Invalid password returns 401 Unauthorized (got ${badPassRes.status})`);

    // 2.4 Dev token endpoint disabled by default
    const devTokenRes = await callRoute('POST', '/auth/dev-token', { role: 'ADMIN' });
    assert(devTokenRes.status === 403, `POST /auth/dev-token rejected when disabled: returns 403 (got ${devTokenRes.status})`);

    // Valid admin login for subsequent tests
    const adminLoginRes = await callRoute('POST', '/auth/login', {
      username: 'admin',
      password: 'adminpassword123'
    });
    assert(adminLoginRes.status === 200, 'Admin login succeeded');
    const adminToken = adminLoginRes.data.token;

    // Valid viewer login for subsequent tests
    const viewerLoginRes = await callRoute('POST', '/auth/login', {
      username: 'viewer',
      password: 'viewerpassword123'
    });
    assert(viewerLoginRes.status === 200, 'Viewer login succeeded');
    const viewerToken = viewerLoginRes.data.token;

    // 3. Unauthorized Role Access (403 Forbidden)
    console.log('\n3. TESTING ROLE-BASED ACCESS CONTROL (403 FORBIDDEN)...');
    
    // VIEWER trying to accept pricing suggestion
    const viewerPatchRes = await callRoute('PATCH', `/pricing-suggestions/${testPricing._id}`, { status: 'ACCEPTED' }, viewerToken);
    assert(viewerPatchRes.status === 403, `VIEWER cannot accept pricing suggestion: returns 403 (got ${viewerPatchRes.status})`);
    assert(viewerPatchRes.data.error.includes('not authorized'), 'Error indicates insufficient role permissions');

    // VIEWER trying to accept reorder suggestion
    const viewerReorderRes = await callRoute('PATCH', `/reorder-suggestions/${testReorder._id}`, { status: 'ACCEPTED' }, viewerToken);
    assert(viewerReorderRes.status === 403, `VIEWER cannot accept reorder suggestion: returns 403 (got ${viewerReorderRes.status})`);

    // MERCHANDISER trying to change /config/strategy
    const merchConfigRes = await callRoute('PATCH', '/config/strategy', { strategy: 'ai' }, merchToken);
    assert(merchConfigRes.status === 403, `MERCHANDISER cannot change /config/strategy: returns 403 (got ${merchConfigRes.status})`);

    // VIEWER trying to change /config/strategy
    const viewerConfigRes = await callRoute('PATCH', '/config/strategy', { strategy: 'ai' }, viewerToken);
    assert(viewerConfigRes.status === 403, `VIEWER cannot change /config/strategy: returns 403 (got ${viewerConfigRes.status})`);

    // 4. Authorized Access & Acting User ID Recording
    console.log('\n4. TESTING AUTHORIZED ACCESS & ACTING USER ID AUDIT TRAIL...');
    
    // ADMIN changes config
    const adminConfigRes = await callRoute('PATCH', '/config/strategy', { strategy: 'rule-based' }, adminToken);
    assert(adminConfigRes.status === 200, `ADMIN successfully updates /config/strategy: 200 OK`);

    // MERCHANDISER accepts pricing suggestion
    const merchAcceptPricing = await callRoute('PATCH', `/pricing-suggestions/${testPricing._id}`, { status: 'ACCEPTED' }, merchToken);
    assert(merchAcceptPricing.status === 200, `MERCHANDISER successfully accepts pricing suggestion: 200 OK`);
    assert(merchAcceptPricing.data.status === 'ACCEPTED', 'Status transitioned to ACCEPTED');
    assert(merchAcceptPricing.data.actedBy === 'usr_merch_01', `Acting user ID recorded on PricingSuggestion: got ${merchAcceptPricing.data.actedBy}`);

    // Check product priceHistory recorded acting user ID
    const updatedProduct = await Product.findById(testProduct._id);
    const latestPriceEntry = updatedProduct.priceHistory.slice(-1)[0];
    assert(latestPriceEntry.changedBy === 'usr_merch_01', `Product priceHistory recorded changedBy: got ${latestPriceEntry.changedBy}`);

    // ADMIN accepts reorder suggestion
    const adminAcceptReorder = await callRoute('PATCH', `/reorder-suggestions/${testReorder._id}`, { status: 'ACCEPTED' }, adminToken);
    assert(adminAcceptReorder.status === 200, `ADMIN successfully accepts reorder suggestion: 200 OK`);
    assert(adminAcceptReorder.data.status === 'ACCEPTED', 'Status transitioned to ACCEPTED');
    assert(adminAcceptReorder.data.actedBy === 'usr_admin_01', `Acting user ID recorded on ReorderSuggestion: got ${adminAcceptReorder.data.actedBy}`);

    // Check snapshot audit recorded acting user ID
    const latestSnapshot = await InventorySnapshot.findOne({ productId: reorderProduct._id, source: 'REORDER_ACCEPTED' }).sort({ createdAt: -1 });
    assert(latestSnapshot !== null, 'InventorySnapshot created for REORDER_ACCEPTED');
    assert(latestSnapshot.actedBy === 'usr_admin_01', `InventorySnapshot recorded actedBy = usr_admin_01 (got ${latestSnapshot?.actedBy})`);

    // 5. Append-Only Integrity on InventorySnapshot (Throws on update/delete)
    console.log('\n5. TESTING APPEND-ONLY GUARDS ON INVENTORYSNAPSHOT...');
    const testSnapshot = await InventorySnapshot.create({
      productId: testProduct._id,
      stockLevel: 10,
      demandVelocity: 2,
      source: 'CREATED'
    });

    let updateOneErr = null;
    try {
      await InventorySnapshot.updateOne({ _id: testSnapshot._id }, { $set: { stockLevel: 999 } });
    } catch (err) {
      updateOneErr = err;
    }
    assert(updateOneErr !== null && updateOneErr.message.includes('append-only'), 'InventorySnapshot.updateOne() throws append-only error');

    let updateManyErr = null;
    try {
      await InventorySnapshot.updateMany({ _id: testSnapshot._id }, { $set: { stockLevel: 999 } });
    } catch (err) {
      updateManyErr = err;
    }
    assert(updateManyErr !== null && updateManyErr.message.includes('append-only'), 'InventorySnapshot.updateMany() throws append-only error');

    let deleteOneErr = null;
    try {
      await InventorySnapshot.deleteOne({ _id: testSnapshot._id });
    } catch (err) {
      deleteOneErr = err;
    }
    assert(deleteOneErr !== null && deleteOneErr.message.includes('append-only'), 'InventorySnapshot.deleteOne() throws append-only error');

    let deleteManyErr = null;
    try {
      await InventorySnapshot.deleteMany({ _id: testSnapshot._id });
    } catch (err) {
      deleteManyErr = err;
    }
    assert(deleteManyErr !== null && deleteManyErr.message.includes('append-only'), 'InventorySnapshot.deleteMany() throws append-only error');

    let findOneAndUpdateErr = null;
    try {
      await InventorySnapshot.findOneAndUpdate({ _id: testSnapshot._id }, { $set: { stockLevel: 999 } });
    } catch (err) {
      findOneAndUpdateErr = err;
    }
    assert(findOneAndUpdateErr !== null && findOneAndUpdateErr.message.includes('append-only'), 'InventorySnapshot.findOneAndUpdate() throws append-only error');

    let replaceOneErr = null;
    try {
      await InventorySnapshot.replaceOne({ _id: testSnapshot._id }, { productId: testProduct._id, stockLevel: 888, demandVelocity: 1, source: 'CREATED' });
    } catch (err) {
      replaceOneErr = err;
    }
    assert(replaceOneErr !== null && replaceOneErr.message.includes('append-only'), 'InventorySnapshot.replaceOne() throws append-only error');

    let findOneAndReplaceErr = null;
    try {
      await InventorySnapshot.findOneAndReplace({ _id: testSnapshot._id }, { productId: testProduct._id, stockLevel: 888, demandVelocity: 1, source: 'CREATED' });
    } catch (err) {
      findOneAndReplaceErr = err;
    }
    assert(findOneAndReplaceErr !== null && findOneAndReplaceErr.message.includes('append-only'), 'InventorySnapshot.findOneAndReplace() throws append-only error');

    let findOneAndDeleteErr = null;
    try {
      await InventorySnapshot.findOneAndDelete({ _id: testSnapshot._id });
    } catch (err) {
      findOneAndDeleteErr = err;
    }
    assert(findOneAndDeleteErr !== null && findOneAndDeleteErr.message.includes('append-only'), 'InventorySnapshot.findOneAndDelete() throws append-only error');

    let bulkWriteUpdateErr = null;
    try {
      await InventorySnapshot.bulkWrite([
        { updateOne: { filter: { _id: testSnapshot._id }, update: { $set: { stockLevel: 999 } } } }
      ]);
    } catch (err) {
      bulkWriteUpdateErr = err;
    }
    assert(bulkWriteUpdateErr !== null && bulkWriteUpdateErr.message.includes('append-only'), 'InventorySnapshot.bulkWrite() with updateOne throws append-only error');

    let bulkWriteDeleteErr = null;
    try {
      await InventorySnapshot.bulkWrite([
        { deleteOne: { filter: { _id: testSnapshot._id } } }
      ]);
    } catch (err) {
      bulkWriteDeleteErr = err;
    }
    assert(bulkWriteDeleteErr !== null && bulkWriteDeleteErr.message.includes('append-only'), 'InventorySnapshot.bulkWrite() with deleteOne throws append-only error');

    // bulkWrite with insertOne is allowed
    const bulkInsertRes = await InventorySnapshot.bulkWrite([
      { insertOne: { document: { productId: testProduct._id, stockLevel: 70, demandVelocity: 3, source: 'CREATED' } } }
    ]);
    assert(bulkInsertRes.insertedCount === 1, 'InventorySnapshot.bulkWrite() allows insertOne append operation');

    // insertMany is allowed as append operation
    const insertManyRes = await InventorySnapshot.insertMany([
      { productId: testProduct._id, stockLevel: 71, demandVelocity: 3, source: 'CREATED' },
      { productId: testProduct._id, stockLevel: 72, demandVelocity: 4, source: 'CREATED' }
    ]);
    assert(insertManyRes.length === 2, 'InventorySnapshot.insertMany() allows appending multiple documents');

    let docSaveErr = null;
    try {
      testSnapshot.stockLevel = 777;
      await testSnapshot.save();
    } catch (err) {
      docSaveErr = err;
    }
    assert(docSaveErr !== null && docSaveErr.message.includes('append-only'), 'Existing InventorySnapshot doc.save() throws append-only error');

    // 6. Append-Only Integrity on AdvisorLog (Throws on update/delete)
    console.log('\n6. TESTING APPEND-ONLY GUARDS ON ADVISORLOG...');
    const testLog = await AdvisorLog.create({
      logType: 'AI_CALL',
      productId: testProduct._id,
      sku: testProduct.sku,
      callType: 'pricing',
      outcome: 'success',
      latencyMs: 120
    });

    let logUpdateOneErr = null;
    try {
      await AdvisorLog.updateOne({ _id: testLog._id }, { $set: { outcome: 'tampered' } });
    } catch (err) {
      logUpdateOneErr = err;
    }
    assert(logUpdateOneErr !== null && logUpdateOneErr.message.includes('append-only'), 'AdvisorLog.updateOne() throws append-only error');

    let logUpdateManyErr = null;
    try {
      await AdvisorLog.updateMany({ _id: testLog._id }, { $set: { outcome: 'tampered' } });
    } catch (err) {
      logUpdateManyErr = err;
    }
    assert(logUpdateManyErr !== null && logUpdateManyErr.message.includes('append-only'), 'AdvisorLog.updateMany() throws append-only error');

    let logDeleteOneErr = null;
    try {
      await AdvisorLog.deleteOne({ _id: testLog._id });
    } catch (err) {
      logDeleteOneErr = err;
    }
    assert(logDeleteOneErr !== null && logDeleteOneErr.message.includes('append-only'), 'AdvisorLog.deleteOne() throws append-only error');

    let logDeleteManyErr = null;
    try {
      await AdvisorLog.deleteMany({ _id: testLog._id });
    } catch (err) {
      logDeleteManyErr = err;
    }
    assert(logDeleteManyErr !== null && logDeleteManyErr.message.includes('append-only'), 'AdvisorLog.deleteMany() throws append-only error');

    let logFindOneAndUpdateErr = null;
    try {
      await AdvisorLog.findOneAndUpdate({ _id: testLog._id }, { $set: { outcome: 'tampered' } });
    } catch (err) {
      logFindOneAndUpdateErr = err;
    }
    assert(logFindOneAndUpdateErr !== null && logFindOneAndUpdateErr.message.includes('append-only'), 'AdvisorLog.findOneAndUpdate() throws append-only error');

    let logReplaceOneErr = null;
    try {
      await AdvisorLog.replaceOne({ _id: testLog._id }, { logType: 'TRIGGER_FIRED', outcome: 'tampered' });
    } catch (err) {
      logReplaceOneErr = err;
    }
    assert(logReplaceOneErr !== null && logReplaceOneErr.message.includes('append-only'), 'AdvisorLog.replaceOne() throws append-only error');

    let logFindOneAndReplaceErr = null;
    try {
      await AdvisorLog.findOneAndReplace({ _id: testLog._id }, { logType: 'TRIGGER_FIRED', outcome: 'tampered' });
    } catch (err) {
      logFindOneAndReplaceErr = err;
    }
    assert(logFindOneAndReplaceErr !== null && logFindOneAndReplaceErr.message.includes('append-only'), 'AdvisorLog.findOneAndReplace() throws append-only error');

    let logFindOneAndDeleteErr = null;
    try {
      await AdvisorLog.findOneAndDelete({ _id: testLog._id });
    } catch (err) {
      logFindOneAndDeleteErr = err;
    }
    assert(logFindOneAndDeleteErr !== null && logFindOneAndDeleteErr.message.includes('append-only'), 'AdvisorLog.findOneAndDelete() throws append-only error');

    let logBulkWriteUpdateErr = null;
    try {
      await AdvisorLog.bulkWrite([
        { updateOne: { filter: { _id: testLog._id }, update: { $set: { outcome: 'tampered' } } } }
      ]);
    } catch (err) {
      logBulkWriteUpdateErr = err;
    }
    assert(logBulkWriteUpdateErr !== null && logBulkWriteUpdateErr.message.includes('append-only'), 'AdvisorLog.bulkWrite() with updateOne throws append-only error');

    let logBulkWriteDeleteErr = null;
    try {
      await AdvisorLog.bulkWrite([
        { deleteOne: { filter: { _id: testLog._id } } }
      ]);
    } catch (err) {
      logBulkWriteDeleteErr = err;
    }
    assert(logBulkWriteDeleteErr !== null && logBulkWriteDeleteErr.message.includes('append-only'), 'AdvisorLog.bulkWrite() with deleteOne throws append-only error');

    // bulkWrite with insertOne is allowed
    const logBulkInsertRes = await AdvisorLog.bulkWrite([
      { insertOne: { document: { logType: 'TRIGGER_FIRED', triggerType: 'MANUAL', advisor: 'ai' } } }
    ]);
    assert(logBulkInsertRes.insertedCount === 1, 'AdvisorLog.bulkWrite() allows insertOne append operation');

    // insertMany is allowed as append operation
    const logInsertManyRes = await AdvisorLog.insertMany([
      { logType: 'TRIGGER_FIRED', triggerType: 'INVENTORY_LOW', advisor: 'rule-based' },
      { logType: 'TRIGGER_FIRED', triggerType: 'DEMAND_SPIKE', advisor: 'rule-based' }
    ]);
    assert(logInsertManyRes.length === 2, 'AdvisorLog.insertMany() allows appending multiple documents');

    let logDocSaveErr = null;
    try {
      testLog.latencyMs = 999;
      await testLog.save();
    } catch (err) {
      logDocSaveErr = err;
    }
    assert(logDocSaveErr !== null && logDocSaveErr.message.includes('append-only'), 'Existing AdvisorLog doc.save() throws append-only error');

    console.log('\n===============================================================');
    console.log(`AUTH & AUDIT TEST SUMMARY: ${passedTests}/${totalTests} PASSED (100.0%)`);
    console.log('===============================================================\n');

    return { totalTests, passedTests };
  } finally {
    await new Promise(r => server.close(r));
  }
}

if (process.argv[1] && process.argv[1].endsWith('authAndAudit.test.js')) {
  runAuthAndAuditTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Auth & Audit test failed:', err);
      process.exit(1);
    });
}
