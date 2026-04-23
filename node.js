require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');
const admin = require('firebase-admin');

const app = express();

// --- 1. CẤU HÌNH FIREBASE ADMIN ---
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (!admin.apps.length) {
    try {
        let config;
        if (serviceAccountKey) {
            config = JSON.parse(serviceAccountKey);
            // Quan trọng: Fix lỗi ký tự \n trong Private Key trên Render
            if (config.private_key) {
                config.private_key = config.private_key.replace(/\\n/g, '\n');
            }
        } else {
            config = require("./serviceAccountKey.json");
        }

        admin.initializeApp({
            credential: admin.credential.cert(config)
        });
        console.log("✅ Firebase Admin Ready");
    } catch (e) {
        console.error("❌ Firebase Auth Error:", e);
    }
}
const db = admin.firestore();

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

// --- 4. GIAO DIỆN PHỤ ---
app.get('/success', (req, res) => {
    res.send(`<html><body style="text-align:center;font-family:sans-serif;padding-top:100px;background:#0f172a;color:white;">
        <h1 style="color:#4ade80;">Thanh toán thành công!</h1>
        <p>Hệ thống đang xử lý giao dịch. Vui lòng quay lại ứng dụng.</p>
        <script>setTimeout(() => { window.close(); }, 3000);</script>
    </body></html>`);
});

app.get('/cancel', (req, res) => res.send("Giao dịch đã bị hủy."));

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        const { orderId, accountCode } = req.body;

        // 1. Lấy thông tin order từ Firebase
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ error: "Không tìm thấy đơn hàng trên hệ thống." });
        }

        const { amount } = orderDoc.data();

        // 2. Tạo orderCode duy nhất (Số nguyên, tối đa 10 chữ số cho an toàn)
        const orderCode = Number(Date.now().toString().slice(-9));

        // 3. Cập nhật mã chuyển khoản vào Order để Webhook đối soát
        await orderRef.update({
            orderCode: orderCode,
            account_code: Number(accountCode),
            status: 'pending'
        });

        // 4. Tạo Link PayOS
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

// --- 6. API WEBHOOK (Xử lý khi có tiền về) ---
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);

        if (webhookData) {
            const orderCode = webhookData.orderCode;

            // 1. Tìm Order tương ứng
            const ordersSnapshot = await db.collection('orders')
                .where('orderCode', '==', orderCode)
                .limit(1)
                .get();

            if (!ordersSnapshot.empty) {
                const orderDoc = ordersSnapshot.docs[0];
                const orderId = orderDoc.id;
                const { user_id, account_id, amount, account_code } = orderDoc.data();

                // 2. Lấy thông tin Nick và User
                const accountRef = db.collection('accounts').doc(account_id);
                const accountSnap = await accountRef.get();
                // Sửa từ 'users' thành 'user' cho đúng cấu trúc bạn đã mô tả
                const userSnap = await db.collection('user').doc(user_id).get();

                if (accountSnap.exists) {
                    const accountData = accountSnap.data();
                    const userName = userSnap.exists ? (userSnap.data().user_name || userSnap.data().full_name) : "Khách QR";

                    // A. Cập nhật Nick thành "Đã bán"
                    await accountRef.update({
                        status: 'Đã bán',
                        sold_to: userName,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // B. Ghi lịch sử giao dịch
                    await db.collection('history').add({
                        user_id: user_id,
                        user_name: userName,
                        account_id: account_id,
                        account_code: account_code || 0,
                        amount: amount,
                        taikhoan: accountData.taikhoan,
                        matkhau: accountData.matkhau,
                        status: 'Thành công',
                        type: 'purchase',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // C. Hoàn tất Order
                    await db.collection('orders').doc(orderId).update({ status: 'completed' });

                    console.log(`✅ Đã giao nick MS${account_code} cho ${userName}`);
                }
            }
        }
        return res.json({ error: 0, message: "Ok" });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.json({ error: -1, message: "Lỗi" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server ready on port ${PORT}`));
