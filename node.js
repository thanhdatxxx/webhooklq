require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();

// --- 1. CẤU HÌNH FIREBASE ADMIN ---
let db;
try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

    if (fs.existsSync(serviceAccountPath)) {
        const rawData = fs.readFileSync(serviceAccountPath, 'utf8');
        const serviceAccount = JSON.parse(rawData);

        // QUAN TRỌNG: Ép kiểu Private Key về chuẩn Google (Xử lý cả \n và \\n)
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin Ready - Project:", serviceAccount.project_id);
        }
        db = admin.firestore();
    } else {
        console.error("❌ ERROR: File serviceAccountKey.json KHONG TON TAI");
    }
} catch (e) {
    console.error("❌ Lỗi khởi tạo Firebase:", e.message);
}

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- 3. KHỞI TẠO PAYOS ---
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// --- 4. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) throw new Error("Firebase initialized failed. Check serviceAccountKey.json");

        const { orderId, accountCode } = req.body;
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ error: "Order not found" });
        }

        const { amount } = orderDoc.data();
        const orderCode = Number(Date.now().toString().slice(-9));

        await orderRef.update({
            orderCode: orderCode,
            account_code: Number(accountCode),
            status: 'pending'
        });

        const body = {
            orderCode: orderCode,
            amount: Math.round(amount),
            description: `MS${accountCode}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        const paymentLinkResponse = await payos.paymentRequests.create(body);
        res.json({ checkoutUrl: paymentLinkResponse.checkoutUrl, orderCode: orderCode });

    } catch (error) {
        console.error("PayOS Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- API WEBHOOK, SUCCESS, CANCEL GIỮ NGUYÊN ---
app.get('/success', (req, res) => res.send("Success"));
app.get('/cancel', (req, res) => res.send("Cancel"));
app.post('/payos-webhook', async (req, res) => {
    // ... code webhook của bạn
    res.json({ error: 0 });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));
