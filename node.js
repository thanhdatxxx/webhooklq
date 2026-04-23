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
        const { amount, accountCode } = req.body;
        const orderCode = Number(Date.now().toString().slice(-6));

        const body = {
            orderCode: orderCode,
            amount: amount,
            description: `Thanh toan MS${accountCode}`,
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
        // Xác thực webhook từ PayOS
        const webhookData = await payos.webhooks.verify(req.body);
        
        if (webhookData) {
            console.log("✅ Thanh toán thành công:", {
                orderCode: webhookData.orderCode,
                amount: webhookData.amount,
                description: webhookData.description,
                reference: webhookData.reference
            });

            // Trích xuất accountCode từ description (format: "Thanh toan MS{accountCode}")
            const accountCode = webhookData.description.match(/MS(\w+)/)?.[1];
            
            if (accountCode) {
                // ===== TÌM KIẾM NICK TRONG COLLECTION accounts =====
                const accountsSnapshot = await db.collection('accounts')
                    .where('accountCode', '==', accountCode)
                    .limit(1)
                    .get();

                if (!accountsSnapshot.empty) {
                    const accountDoc = accountsSnapshot.docs[0];
                    const accountData = accountDoc.data();
                    const nick = accountData.nick;

                    console.log(`📌 Tìm thấy Nick: ${nick}`);

                    // ===== GHI HÓAĐƠN VÀO COLLECTION history =====
                    const historyRecord = {
                        nick: nick,
                        accountCode: accountCode,
                        orderCode: webhookData.orderCode,
                        amount: webhookData.amount,
                        reference: webhookData.reference,
                        description: webhookData.description,
                        paymentDate: webhookData.transactionDateTime,
                        paymentMethod: 'PayOS',
                        status: 'completed',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        rawData: webhookData // Lưu toàn bộ dữ liệu webhook
                    };

                    // Lưu vào collection history
                    const historyRef = await db.collection('history').add(historyRecord);
                    
                    console.log(`💾 Ghi hóa đơn thành công - Document ID: ${historyRef.id}`);

                    // (Optional) Cập nhật balance hoặc trạng thái account
                    // await accountDoc.ref.update({
                    //     balance: admin.firestore.FieldValue.increment(webhookData.amount),
                    //     lastPaymentDate: admin.firestore.FieldValue.serverTimestamp()
                    // });

                } else {
                    console.warn(`⚠️ Không tìm thấy account với code: ${accountCode}`);
                }
            } else {
                console.warn("⚠️ Không tìm thấy accountCode trong description");
            }
        }

        // Trả về response thành công cho PayOS
        return res.json({ error: 0, message: "Ok", data: null });
        
    } catch (error) {
        console.error("❌ Webhook Error:", error);
        // Trả về error nhưng không dừa xử lý - PayOS sẽ retry
        return res.json({ error: -1, message: "Lỗi xác thực", data: null });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});