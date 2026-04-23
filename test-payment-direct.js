require('dotenv').config();
const { PayOS } = require('@payos/node');

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

console.log("PayOS Config:");
console.log("  Client ID:", payos.clientId);
console.log("  API Key:", payos.apiKey);
console.log("  Checksum Key:", payos.checksumKey);
console.log("  Base URL:", payos.baseURL);

(async () => {
  try {
    const orderCode = 123456;
    const body = {
        orderCode: orderCode,
        amount: 100000,
        description: "Thanh toan MS123",
        cancelUrl: "https://webhooklq.onrender.com/cancel",
        returnUrl: "https://webhooklq.onrender.com/success",
    };

    console.log("\nRequest body:");
    console.log(JSON.stringify(body, null, 2));

    // Try to create payment link
    const response = await payos.paymentRequests.create(body);
    console.log("\nSuccess! Response:");
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error("\nError:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    console.error("Full error:", error);
  }
})();
