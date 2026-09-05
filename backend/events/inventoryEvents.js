import { EventEmitter } from 'events';

// Create and export a singleton event bus
const inventoryEvents = new EventEmitter();

export default inventoryEvents;
