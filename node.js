require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');
const admin = require('firebase-admin');

const app = express();

// --- 1. CẤU HÌNH FIREBASE ADMIN (PHIÊN BẢN CHỐNG LỖI 16) ---
let db;
let initError = null;

try {
    const base64Config = process.env.FIREBASE_CONFIG_BASE64;

    if (base64Config) {
        // Giải mã chuỗi Base64 từ biến môi trường của Render
        const serviceAccount = JSON.parse(Buffer.from(base64Config, 'base64').toString('utf-8'));

        // Xử lý Private Key để tránh lỗi định dạng ký tự xuống dòng
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }

        // Khởi tạo Firebase Admin
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin Initialized - Project:", serviceAccount.project_id);
        }

        db = admin.firestore();
    } else {
        initError = "Thiếu biến môi trường FIREBASE_CONFIG_BASE64 trên Render!";
        console.error("❌", initError);
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

// --- 4. API DEBUG (Để bạn kiểm tra xem Firebase đã thông chưa) ---
app.get('/debug', (req, res) => {
    res.json({
        firebaseStatus: db ? "Connected" : "Failed",
        initError: initError,
        serverTimeUTC: new Date().toISOString(),
        nodeVersion: process.version
    });
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        if (!db) throw new Error(`Firebase not initialized: ${initError}`);

        const { orderId, accountCode } = req.body;

        // Truy vấn Firestore (Nếu bị lỗi 16, nó sẽ chết tại dòng này)
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

        const { amount } = orderDoc.data();
        const orderCode = Number(Date.now().toString().slice(-9));

        // Cập nhật thông tin đơn hàng trước khi sang PayOS
        await orderRef.update({
            orderCode,
            account_code: Number(accountCode),
            status: 'pending'
        });

        const paymentLinkResponse = await payos.paymentRequests.create({
            orderCode,
            amount: Math.round(amount),
            description: `MS${accountCode}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`, // Thay bằng domain của bạn
            returnUrl: `https://webhooklq.onrender.com/success`, // Thay bằng domain của bạn
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

// --- 6. WEBHOOK XỬ LÝ KHI THANH TOÁN XONG ---
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);
        
        if (webhookData) {
            // Tìm đơn hàng dựa trên orderCode từ PayOS
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

                    // 1. Cập nhật trạng thái Account sang "Đã bán"
                    await accountRef.update({
                        status: 'Đã bán',
                        sold_to: user_id,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // 2. Lưu vào lịch sử mua hàng
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

                    // 3. Đánh dấu đơn hàng hoàn tất
                    await orderDoc.ref.update({ status: 'completed' });
                }
            }
        }
        return res.json({ error: 0 });
    } catch (error) {
        console.error("Webhook Error:", error.message);
        return res.json({ error: -1 });
    }
});

app.get('/success', (req, res) => res.send("Thanh toán thành công! Hệ thống đang xử lý."));
app.get('/cancel', (req, res) => res.send("Bạn đã hủy thanh toán."));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${PORT}`));