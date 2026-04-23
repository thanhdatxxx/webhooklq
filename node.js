const express = require('express');
const { PayOS } = require("@payos/node");
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Cấu hình PayOS với thông tin bạn đã chụp ảnh
// Cập nhật phần cấu hình PayOS trong file node.js
const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID,     // Thay cho mã cũ
    process.env.PAYOS_API_KEY,        // Thay cho mã cũ
    process.env.PAYOS_CHECKSUM_KEY    // Thay cho mã cũ
);

// 2. API Tạo link thanh toán VietQR
app.post('/create-payment-link', async (req, res) => {
    const { amount, accountCode, userName } = req.body;

    const orderCode = Number(Date.now().toString().slice(-6)); // Tạo mã đơn hàng số
    const body = {
        orderCode: orderCode,
        amount: amount,
        description: `Thanh toan MS${accountCode}`,
        returnUrl: `https://your-web-app.com/success`, // Trang quay lại khi khách thanh toán xong
        cancelUrl: `https://your-web-app.com/cancel`,
    };

    try {
        const paymentLinkResponse = await payos.createPaymentLink(body);
        // Lưu orderCode này vào Database của bạn để đối soát sau này
        res.json({ checkoutUrl: paymentLinkResponse.checkoutUrl, orderCode });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//3. API Webhook - Sửa lại để trả về đúng chuẩn PayOS yêu cầu
app.post('/payos-webhook', async (req, res) => {
    try {
        const webhookData = payos.verifyPaymentWebhookData(req.body);

        if (webhookData) {
            console.log("Thanh toán thành công đơn hàng:", webhookData.orderCode);

            // TẠI ĐÂY: Bạn viết code để tự động gửi mật khẩu cho khách
            // Ví dụ: updateDatabase(webhookData.orderCode, "Đã giao hàng");
        }

        // PHẢI trả về đúng định dạng này PayOS mới chấp nhận
        return res.json({
            error: 0,
            message: "Ok",
            data: null
        });

    } catch (error) {
        console.error("Lỗi Webhook:", error);
        return res.json({
            error: -1,
            message: "Mã lỗi xác thực dữ liệu",
            data: null
        });
    }
});

// 4. Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});