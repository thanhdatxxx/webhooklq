require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import PayOS
const { PayOS } = require('@payos/node'); 

const admin = require('firebase-admin');
// ... giữ nguyên phần khởi tạo Firebase và Express bên dưới

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
            // Gửi ID vào description (max 25 kí tự)
            description: `${accountId}`,
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

// --- 6. API WEBHOOK (XỬ LÝ TỰ ĐỘNG HOÀN TOÀN) ---
app.post('/payos-webhook', async (req, res) => {
    try {
        // Xác thực tin nhắn từ PayOS
        const webhookData = await payos.webhooks.verify(req.body);

        if (webhookData) {
            console.log("✅ Nhận tín hiệu thanh toán thành công:", webhookData.description);
            
            // Description chứa accountId
            const accountId = webhookData.description.trim();
            
            if (accountId) {
                // Query Firestore để tìm document theo field id
                const accountDoc = await db.collection('accounts').doc(accountId).get();

                if (accountDoc.exists) {
                    const accountData = accountDoc.data();
                    const userName = accountData.sold_to || "Unknown"; // Tên người mua

                    // ===== A. LẤY THÔNG TIN TÀI KHOẢN & LƯUCHO KHÁCH =====
                    await db.collection('user').add({
                        user_name: userName,
                        account_id: accountId,
                        id: accountData?.id || "N/A",
                        taikhoan: accountData?.taikhoan || "N/A",
                        matkhau: accountData?.matkhau || "N/A",
                        hero_count: accountData?.hero_count || 0,
                        skin_count: accountData?.skin_count || 0,
                        rank: accountData?.rank || "N/A",
                        price: accountData?.price || 0,
                        purchased_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    // ===== B. CẬP NHẬT STATUS TÀI KHOẢN THÀNH "ĐÃ BÁN" =====
                    await db.collection('accounts').doc(accountId).update({
                        status: 'Đã bán',
                        sold_to: userName,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // ===== C. GHI LỮC SỬ GIAO DỊCH =====
                    await db.collection('history').add({
                        user_name: userName,
                        id: accountData?.id || "N/A",
                        account_id: accountId,
                        taikhoan: accountData?.taikhoan || "N/A",
                        amount: webhookData.amount,
                        transaction_code: webhookData.orderCode.toString(),
                        type: 'purchase',
                        status: 'Thành công',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    console.log(`💾 ✅ Đã giao nick ID: ${accountId} cho User: ${userName}`);
                    console.log(`📝 Tài khoản: ${accountData?.taikhoan} | Mật khẩu: ${accountData?.matkhau}`);
                } else {
                    console.log(`⚠️ Không tìm thấy tài khoản ID: ${accountId}`);
                }
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
