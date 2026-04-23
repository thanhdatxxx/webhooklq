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
let initError = null;

try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

    if (fs.existsSync(serviceAccountPath)) {
        const rawData = fs.readFileSync(serviceAccountPath, 'utf8');
        const serviceAccount = JSON.parse(rawData);

        // Fix lỗi format Private Key (đảm bảo không bị sai ký tự xuống dòng)
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key
                .replace(/\\n/g, '\n')
                .replace(/\n/g, '\n')
                .trim();
        }

        // Khởi tạo app mặc định (Default App)
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin Initialized - Project:", serviceAccount.project_id);
        }

        db = admin.firestore();
    } else {
        initError = "File serviceAccountKey.json not found on server";
    }
} catch (e) {
    initError = e.message;
    console.error("❌ Firebase Init Error:", e.message);
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

// --- 4. API DEBUG (Đã sửa lỗi crash) ---
app.get('/debug', (req, res) => {
    try {
        res.json({
            firebaseStatus: db ? "Connected" : "Failed",
            initError: initError,
            serverTimeUTC: new Date().toISOString(),
            projectId: (admin.apps.length > 0 && admin.app().options.credential) ? admin.app().options.projectId : "N/A",
            nodeVersion: process.version
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) throw new Error(`Firebase not initialized: ${initError}`);

        const { orderId, accountCode } = req.body;

        // Kiểm tra kết nối Firestore (Lỗi 16 thường nổ ra tại đây)
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

        const { amount } = orderDoc.data();
        const orderCode = Number(Date.now().toString().slice(-9));

        await orderRef.update({
            orderCode,
            account_code: Number(accountCode),
            status: 'pending'
        });

        const paymentLinkResponse = await payos.paymentRequests.create({
            orderCode,
            amount: Math.round(amount),
            description: `MS${accountCode}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        });

        res.json({ checkoutUrl: paymentLinkResponse.checkoutUrl, orderCode });

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({
            error: error.message,
            isAuthError: error.message.includes('16') || error.message.includes('UNAUTHENTICATED')
        });
    }
});

app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);
        if (webhookData) {
            const ordersSnapshot = await db.collection('orders')
                .where('orderCode', '==', webhookData.orderCode)
                .limit(1).get();

            if (!ordersSnapshot.empty) {
                const orderDoc = ordersSnapshot.docs[0];
                const { user_id, account_id, amount, account_code } = orderDoc.data();
                const accountRef = db.collection('accounts').doc(account_id);
                const accountSnap = await accountRef.get();

                if (accountSnap.exists) {
                    const accountData = accountSnap.data();
                    await accountRef.update({
                        status: 'Đã bán',
                        sold_to: user_id,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    await db.collection('history').add({
                        user_id,
                        account_id,
                        account_code: account_code || 0,
                        amount,
                        taikhoan: accountData.taikhoan,
                        matkhau: accountData.matkhau,
                        status: 'Thành công',
                        type: 'purchase',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    await orderDoc.ref.update({ status: 'completed' });
                }
            }
        }
        return res.json({ error: 0 });
    } catch (error) {
        return res.json({ error: -1 });
    }
});

app.get('/success', (req, res) => res.send("Thành công!"));
app.get('/cancel', (req, res) => res.send("Hủy bỏ."));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${PORT}`));
