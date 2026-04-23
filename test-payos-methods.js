require('dotenv').config();
const { PayOS } = require('@payos/node');

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

console.log("Direct payos methods:");
const directMethods = Object.getOwnPropertyNames(payos)
  .filter(m => typeof payos[m] === 'function');
directMethods.forEach(m => console.log(`  - ${m}`));

console.log("\nPayOS instance properties:");
console.log("  - webhooks:", typeof payos.webhooks);
console.log("  - paymentRequests:", typeof payos.paymentRequests);
console.log("  - payouts:", typeof payos.payouts);

console.log("\nAll properties:");
console.log(Object.keys(payos));
