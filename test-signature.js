require('dotenv').config();
const { PayOS } = require('@payos/node');

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

console.log("PayOS crypto methods:");
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(payos.crypto)));

// Test creating signature
const testData = {
    orderCode: 123456,
    amount: 100000,
    description: "Test payment"
};

(async () => {
  try {
    const signature = await payos.crypto.createSignatureOfPaymentRequest(testData);
    console.log("\nSignature created:", signature);
    console.log("Type:", typeof signature);
  } catch (e) {
    console.error("Error:", e.message);
  }
})();
