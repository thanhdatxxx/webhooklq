require('dotenv').config();
const { PayOS } = require('@payos/node');

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

console.log("PayOS instance methods:");
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(payos)));
console.log("\nAvailable methods:");
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(payos))
  .filter(m => typeof payos[m] === 'function');
methods.forEach(m => console.log(`  - ${m}`));
