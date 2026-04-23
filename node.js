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
        const { orderId, accountCode } = req.body; 
        // orderId = Document ID của orders collection (được tạo từ client)
        
        // 1. QUERY ORDERS COLLECTION ĐỂ LẤY THÔNG TIN
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return res.status(404).json({ error: "Order không tồn tại" });
        }
        
        const orderData = orderDoc.data();
        const { user_id, account_id, amount } = orderData;
        
        console.log(`📋 Tìm thấy order: user=${user_id}, account=${account_id}, amount=${amount}`);

        // 2. Tạo orderCode là số nguyên duy nhất (PayOS bắt buộc là số)
        const orderCode = Number(Date.now().toString().slice(-9));

        // 3. LƯU ORDERCODE VÀO ORDERS COLLECTION ĐỂ WEBHOOK CÓ THỂ QUERY
        await db.collection('orders').doc(orderId).update({
            orderCode: orderCode,
            status: 'pending'
        });

        // 4. TẠO PAYMENT LINK
        const body = {
            orderCode: orderCode,
            amount: amount,
            description: `THANH TOAN MS${accountCode}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        const paymentLinkResponse = await payos.paymentRequests.create(body);
        res.json({ 
            checkoutUrl: paymentLinkResponse.checkoutUrl, 
            orderCode: orderCode 
        });
    } catch (error) {
        console.error("Create Payment Link Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- 6. API WEBHOOK (XỬ LÝ TỰ ĐỘNG HOÀN TOÀN) ---
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);

        if (webhookData) {
            const orderCode = webhookData.orderCode;
            console.log("✅ Nhận webhook từ PayOS - OrderCode:", orderCode);

            // 1. QUERY ORDERS COLLECTION ĐỂ TÌM DOCUMENT CHỨA ORDERCODE NÀY
            const ordersSnapshot = await db.collection('orders')
                .where('orderCode', '==', orderCode)
                .limit(1)
                .get();
            
            if (!ordersSnapshot.empty) {
                const orderDoc = ordersSnapshot.docs[0];
                const orderId = orderDoc.id;
                const { user_id, account_id, amount } = orderDoc.data();
                
                console.log(`📦 Tìm thấy order ${orderId}: user=${user_id}, account=${account_id}`);

                // 2. LẤY THÔNG TIN USER VÀ ACCOUNT
                const userSnap = await db.collection('user').doc(user_id).get();
                const accountSnap = await db.collection('accounts').doc(account_id).get();

                if (accountSnap.exists) {
                    const accountData = accountSnap.data();
                    const userName = userSnap.exists ? userSnap.data().user_name : "Unknown";

                    // ===== A. CẬP NHẬT STATUS TÀI KHOẢN THÀNH "ĐÃ BÁN" =====
                    await db.collection('accounts').doc(account_id).update({
                        status: 'Đã bán',
                        sold_to: userName,
                        sold_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // ===== B. GHI LỮC SỬ GIAO DỊCH =====
                    await db.collection('history').add({
                        user_id: user_id,
                        account_id: account_id,
                        order_id: orderId,
                        amount: amount,
                        taikhoan: accountData?.taikhoan || "N/A",
                        status: 'Thành công',
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    // ===== C. CẬP NHẬT TRẠNG THÁI ORDER =====
                    await db.collection('orders').doc(orderId).update({
                        status: 'completed',
                        completed_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    console.log(`💾 ✅ Đã giao nick cho User: ${userName}`);
                    console.log(`📝 Tài khoản: ${accountData?.taikhoan} | Mật khẩu: ${accountData?.matkhau}`);
                } else {
                    console.log(`❌ Không tìm thấy tài khoản ID: ${account_id}`);
                }
            } else {
                console.log(`❌ Không tìm thấy order với orderCode: ${orderCode}`);
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
