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
        // Đọc file dưới dạng string để xử lý lỗi format
        let rawData = fs.readFileSync(serviceAccountPath, 'utf8');
        let serviceAccount = JSON.parse(rawData);

        // QUAN TRỌNG: Sửa lỗi \\n thành \n trong Private Key
        if (serviceAccount.private_key && serviceAccount.private_key.includes('\\n')) {
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
        console.error("❌ ERROR: File serviceAccountKey.json KHONG TON TAI tai:", serviceAccountPath);
    }
} catch (e) {
    console.error("❌ Lỗi khởi tạo Firebase:", e.message);
}

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- 3. KHỞI TẠO PAYOS ---
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// --- 4. API DEBUG ---
app.get('/debug', (req, res) => {
    res.json({
        firebase_app: admin.apps.length > 0 ? "Initialized" : "Failed",
        project_id: admin.apps.length > 0 ? admin.app().options.credential.projectId : "None",
        key_file_exists: fs.existsSync(path.join(__dirname, 'serviceAccountKey.json')),
        cwd: __dirname
    });
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ error: "Firebase chưa được khởi tạo thành công." });

        const { orderId, accountCode } = req.body;
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });

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
        console.error("PayOS Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- 6. API WEBHOOK ---
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

app.get('/success', (req, res) => res.send("Thanh toán thành công!"));
app.get('/cancel', (req, res) => res.send("Đã hủy giao dịch."));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server ready on port ${PORT}`));
