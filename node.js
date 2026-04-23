require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');

// --- FIREBASE SETUP ---
const admin = require('firebase-admin');

// Load Firebase credentials from environment variable
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : require("./serviceAccountKey.json"); // Fallback for local development

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKey)
});
const db = admin.firestore();
// ----------------------

const app = express();

// FIX LỖI "Failed to fetch" trên Flutter Web
app.use(cors()); 

app.use(express.json());

// Khởi tạo PayOS
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// API Tạo link thanh toán
app.post('/create-payment-link', async (req, res) => {
    try {
        const { amount, accountCode, userName } = req.body; // Thêm userName
        const orderCode = Number(Date.now().toString().slice(-6));

        const body = {
            orderCode: orderCode,
            amount: amount,
            // QUAN TRỌNG: Gắn cả accountCode và userName vào để Webhook đọc lại
            description: `MS${accountCode} USER_${userName}`, 
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        const paymentLinkResponse = await payos.paymentRequests.create(body);
        // Trả về đúng cấu trúc mà App Flutter đang chờ
        res.json({
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode: orderCode
        });
    } catch (error) {
        console.error("PayOS Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// API Webhook - Xử lý tự động khi PayOS báo thành công
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);
        if (webhookData) {
            const desc = webhookData.description; // Ví dụ: "MS123002 USER_thanhdat"
            // Tách dữ liệu từ description
            const accountCode = desc.match(/MS(\d+)/)?.[1];
            const userName = desc.match(/USER_(\w+)/)?.[1] || "Khách VietQR";

            if (accountCode) {
                // 1. Tìm nick trong collection 'accounts'
                // Lưu ý: Kiểm tra lại tên field trong Firestore là 'accountCode' hay 'account_code'
                const snapshot = await db.collection('accounts')
                    .where('account_code', '==', parseInt(accountCode)) // Nếu trong DB là kiểu Number
                    .limit(1).get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    const accountData = doc.data();

                    // 2. Cập nhật trạng thái và người mua
                    await doc.ref.update({
                        status: 'Đã bán',
                        sold_to: userName,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // 3. Ghi lịch sử mua hàng (giúp HistoryScreen hiển thị)
                    await db.collection('history').add({
                        user_name: userName,
                        account_code: parseInt(accountCode),
                        account_id: doc.id,
                        amount: webhookData.amount,
                        transaction_code: webhookData.orderCode.toString(),
                        type: 'purchase',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`✅ Đã giao nick ${accountCode} cho ${userName}`);
                }
            }
        }
        return res.json({ error: 0, message: "Ok", data: null });
    } catch (error) {
        return res.json({ error: -1, message: "Lỗi xác thực", data: null });    }
});


const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});