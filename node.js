require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { PayOS } = require('@payos/node');

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

// API Webhook
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = await payos.webhooks.verify(req.body);
        if (webhookData) {
            console.log("Thanh toán thành công đơn hàng:", webhookData.orderCode);
        }
        return res.json({ error: 0, message: "Ok", data: null });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.json({ error: -1, message: "Lỗi xác thực", data: null });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});