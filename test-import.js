// Test different import patterns
console.log("Testing imports...");

try {
  console.log("\n1. Testing: const { PayOS } = require('@payos/node');");
  const { PayOS: PayOS1 } = require('@payos/node');
  console.log("   Result:", typeof PayOS1);
} catch (e) {
  console.log("   Error:", e.message);
}

try {
  console.log("\n2. Testing: const PayOS = require('@payos/node');");
  const PayOS2 = require('@payos/node');
  console.log("   Result:", typeof PayOS2);
  console.log("   Keys:", Object.keys(PayOS2).slice(0, 5));
} catch (e) {
  console.log("   Error:", e.message);
}

try {
  console.log("\n3. Testing: const PayOS = require('@payos/node').PayOS;");
  const PayOS3 = require('@payos/node').PayOS;
  console.log("   Result:", typeof PayOS3);
} catch (e) {
  console.log("   Error:", e.message);
}

try {
  console.log("\n4. Testing: const PayOS = require('@payos/node').default;");
  const PayOS4 = require('@payos/node').default;
  console.log("   Result:", typeof PayOS4);
} catch (e) {
  console.log("   Error:", e.message);
}
