const express = require('express');
const cors = require('cors');
const PayOS = require("@payos/node").default;

const app = express();

// PHẢI CÓ DÒNG NÀY ĐỂ FIX LỖI "Failed to fetch" TRÊN WEB
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Khởi tạo PayOS từ biến môi trường
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// API Tạo link thanh toán
app.post('/create-payment-link', async (req, res) => {
    try {
        const { amount, accountCode } = req.body;

        // Tạo mã đơn hàng ngẫu nhiên (số)
        const orderCode = Number(Date.now().toString().slice(-6));
        
        const body = {
            orderCode: orderCode,
            amount: amount,
            description: `Thanh toan MS${accountCode}`,
            cancelUrl: `https://webhooklq.onrender.com/cancel`,
            returnUrl: `https://webhooklq.onrender.com/success`,
        };

        // Dùng thư viện payos để tạo link (tự động xử lý signature)
        const paymentLinkResponse = await payos.createPaymentLink(body);
        
        res.json({
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode: orderCode
        });
    } catch (error) {
        console.error("PayOS Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// API Webhook nhận thông tin từ PayOS
app.post('/payos-webhook', async (req, res) => {
    try {
        // Thư viện tự động kiểm tra signature cho bạn
        const webhookData = payos.verifyPaymentWebhookData(req.body);

        if (webhookData) {
            console.log("Khách đã thanh toán thành công đơn hàng:", webhookData.orderCode);
            // CODE TỰ ĐỘNG GIAO NICK Ở ĐÂY
        }

        return res.json({ error: 0, message: "Ok", data: null });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.json({ error: -1, message: "Lỗi xác thực", data: null });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});