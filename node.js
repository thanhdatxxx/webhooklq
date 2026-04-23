require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');
const admin = require('firebase-admin');

// --- 1. KHỞI TẠO FIREBASE ADMIN ---
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) 
    : require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// --- 2. CÁC ROUTE ĐIỀU HƯỚNG (FIX LỖI CANNOT GET /SUCCESS) ---
app.get('/success', (req, res) => {
    // Chuyển hướng khách về lại trang web của bạn sau 3 giây hoặc hiện thông báo
    res.send(`
        <html>
            <body style="text-align:center; font-family:sans-serif; padding-top:50px;">
                <h2 style="color:green;">Thanh toán thành công!</h2>
                <p>Hệ thống đang xử lý đơn hàng. Vui lòng quay lại ứng dụng Shop.</p>
                <script>setTimeout(() => { window.close(); }, 3000);</script>
            </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => {
    res.send("Giao dịch đã bị hủy. Vui lòng quay lại Shop.");
});

// --- 3. API TẠO LINK THANH TOÁN ---
app.post('/create-payment-link', async (req, res) => {
    try {
        const { amount, accountCode, userName } = req.body;
        const orderCode = Number(Date.now().toString().slice(-6));

        const body = {
            orderCode: orderCode,
            amount: amount,
            // Gắn thông tin vào description để Webhook đọc lại
            description: `MS${accountCode} USER_${userName}`, 
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        const paymentLinkResponse = await payos.paymentRequests.create(body);
        res.json({
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode: orderCode
        });
    } catch (error) {
        console.error("PayOS Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- 4. API WEBHOOK (XỬ LÝ TỰ ĐỘNG FIREBASE) ---
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);
        
        if (webhookData) {
            console.log("✅ Webhook nhận dữ liệu:", webhookData.description);
            
            // Trích xuất MS và User từ description (Ví dụ: "MS123002 USER_thanhdat")
            const desc = webhookData.description;
            const accountCodeMatch = desc.match(/MS(\d+)/);
            const userMatch = desc.match(/USER_(\w+)/);

            if (accountCodeMatch) {
                const accountCode = parseInt(accountCodeMatch[1]);
                const userName = userMatch ? userMatch[1] : "Unknown";

                // A. Tìm Nick trong Firestore
                const snapshot = await db.collection('accounts')
                    .where('account_code', '==', accountCode)
                    .limit(1).get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    
                    // B. Cập nhật trạng thái Nick
                    await doc.ref.update({
                        status: 'Đã bán',
                        sold_to: userName,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // C. Ghi lịch sử giao dịch
                    await db.collection('history').add({
                        user_name: userName,
                        account_code: accountCode,
                        account_id: doc.id,
                        amount: webhookData.amount,
                        transaction_code: webhookData.orderCode.toString(),
                        type: 'purchase',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    console.log(`💾 Đã cập nhật Firebase cho đơn hàng MS${accountCode}`);
                }
            }
        }
        return res.json({ error: 0, message: "Ok", data: null });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.json({ error: -1, message: "Lỗi", data: null });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});