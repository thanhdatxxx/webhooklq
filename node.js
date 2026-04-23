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

        // XỬ LÝ PRIVATE KEY TRIỆT ĐỂ (Xóa khoảng trắng, sửa newline)
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key
                .replace(/\\n/g, '\n')
                .replace(/\n/g, '\n')
                .trim();
        }

        // Khởi tạo App với ID riêng để tránh cache/conflict trên Render
        const appName = `shop-app-${Date.now()}`;
        const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        }, appName);

        db = firebaseApp.firestore();
        console.log(`✅ Firebase Ready [${serviceAccount.project_id}] - Time: ${new Date().toISOString()}`);
    } else {
        console.error("❌ ERROR: Missing serviceAccountKey.json");
    }
} catch (e) {
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

// --- 4. API DEBUG (Rất quan trọng để check lỗi 16) ---
app.get('/debug', (req, res) => {
    res.json({
        status: db ? "Firebase Connected" : "Firebase Null",
        serverTimeUTC: new Date().toISOString(),
        nodeVersion: process.version,
        adminVersion: require('firebase-admin/package.json').version,
        projectId: admin.apps.length > 0 ? admin.app().options.projectId : "N/A",
        hint: "Nếu giờ server lệch quá 5 phút so với giờ điện thoại, đó là nguyên nhân lỗi 16."
    });
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) throw new Error("Database connection not established");

        const { orderId, accountCode } = req.body;

        // Gọi thử Firestore để kiểm tra Auth ngay lập tức
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get().catch(err => {
            // NẾU LỖI 16 XẢY RA, NÓ SẼ BỊ BẮT Ở ĐÂY
            throw new Error(`Firestore Auth Error (${err.code}): ${err.message}`);
        });

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
        console.error("🔥 SERVER ERROR:", error.message);
        res.status(500).json({
            error: error.message,
            full_error: error.toString() // Trả về chi tiết để debug trên Flutter
        });
    }
});

// --- API WEBHOOK, SUCCESS, CANCEL ---
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
app.get('/cancel', (req, res) => res.send("Giao dịch bị hủy."));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server ready on port ${PORT}`));
