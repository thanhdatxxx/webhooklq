require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node').default; // Fix lỗi constructor
const admin = require('firebase-admin');

const app = express();

// --- 1. CẤU HÌNH FIREBASE ADMIN ---
// Đọc từ biến môi trường trên Render mà bạn đã thiết lập
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) 
    : require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// --- 2. MIDDLEWARE ---
app.use(cors()); // Fix lỗi Failed to fetch
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- 3. KHỞI TẠO PAYOS ---
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// --- 4. CÁC ĐƯỜNG DẪN GIAO DIỆN (FIX LỖI CANNOT GET) ---
app.get('/success', (req, res) => {
    res.send(`
        <html>
            <body style="text-align:center; font-family:sans-serif; padding-top:100px; background:#0f172a; color:white;">
                <h1 style="color:#4ade80;">Thanh toán thành công!</h1>
                <p>Hệ thống đang xử lý giao dịch ngầm.</p>
                <p>Vui lòng quay lại ứng dụng của bạn.</p>
                <script>setTimeout(() => { window.close(); }, 3000);</script>
            </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => {
    res.send("Giao dịch đã bị hủy. Vui lòng đóng cửa sổ này.");
});

// --- 5. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        const { amount, accountId, accountCode, userName } = req.body;
        
        // Tạo mã đơn hàng ngẫu nhiên (số)
        const orderCode = Number(Date.now().toString().slice(-6));

        const body = {
            orderCode: orderCode,
            amount: amount,
            // Gắn Document ID vào description để Webhook tìm chính xác 100%
            description: `ID_${accountId} MS${accountCode} USER_${userName}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        const paymentLinkResponse = await payos.createPaymentLink(body);
        
        res.json({
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode: orderCode
        });
    } catch (error) {
        console.error("PayOS Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- 6. API WEBHOOK (XỬ LÝ TỰ ĐỘNG HOÀN TOÀN) ---
app.post('/payos-webhook', async (req, res) => {
    try {
        // Xác thực tin nhắn từ PayOS
        const webhookData = payos.verifyPaymentWebhookData(req.body);

        if (webhookData) {
            console.log("✅ Nhận tín hiệu thanh toán thành công:", webhookData.description);
            
            // Trích xuất thông tin từ description
            const desc = webhookData.description;
            const docId = desc.match(/ID_(\w+)/)?.[1]; // Lấy Document ID
            const userName = desc.match(/USER_(\w+)/)?.[1] || "Unknown";
            const accountCode = desc.match(/MS(\d+)/)?.[1] || "000";

            if (docId) {
                // A. Cập nhật trạng thái nick trong Firestore bằng ID trực tiếp
                const accountRef = db.collection('accounts').doc(docId);
                await accountRef.update({
                    status: 'Đã bán',
                    sold_to: userName,
                    sold_at: admin.firestore.FieldValue.serverTimestamp()
                });

                // B. Ghi vào lịch sử mua hàng cho người dùng
                await db.collection('history').add({
                    user_name: userName,
                    account_code: parseInt(accountCode),
                    account_id: docId,
                    amount: webhookData.amount,
                    transaction_code: webhookData.orderCode.toString(),
                    type: 'purchase',
                    created_at: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`💾 Đã giao nick ID: ${docId} cho User: ${userName}`);
            }
        }

        // Phải trả về response này PayOS mới không gửi lại Webhook nữa
        return res.json({ error: 0, message: "Ok", data: null });

    } catch (error) {
        console.error("❌ Webhook Error:", error);
        return res.json({ error: -1, message: "Lỗi xác thực", data: null });
    }
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
