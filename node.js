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
            serviceAccount.private_key = serviceAccount.private_key
                .replace(/\\n/g, '\n')
                .trim();
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin Ready - Project:", serviceAccount.project_id);
            console.log("🕒 Server Time (UTC):", new Date().toISOString());
        }
        db = admin.firestore();

        // Cấu hình để chịu lỗi lệch thời gian nhẹ (nếu có)
        db.settings({ ignoreUndefinedProperties: true });
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

// --- 4. API DEBUG (Kiểm tra lệch thời gian) ---
app.get('/debug', (req, res) => {
    res.json({
        firebase: admin.apps.length > 0 ? "Initialized" : "Failed",
        serverTimeUTC: new Date().toISOString(),
        serverTimeVN: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        projectId: admin.apps.length > 0 ? admin.app().options.credential.projectId : "None"
    });
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) throw new Error("Firebase initialized failed. Check serviceAccountKey.json");

        const { orderId, accountCode } = req.body;
        const orderRef = db.collection('orders').doc(orderId);

        // Đoạn này sẽ lỗi 16 nếu Key hoặc Time bị lệch
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
        console.error("🔥 LỖI TẠI SERVER:", error.message);
        res.status(500).json({
            error: error.message,
            tip: "Kiểm tra link /debug xem giờ server có lệch quá 5 phút so với thực tế không."
        });
    }
});

// --- API WEBHOOK ---
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

app.get('/success', (req, res) => res.send("Success"));
app.get('/cancel', (req, res) => res.send("Cancel"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server ready on port ${PORT}`));
