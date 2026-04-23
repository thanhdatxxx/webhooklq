const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// PayOS Config
const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID;
const PAYOS_API_KEY = process.env.PAYOS_API_KEY;
const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY;
const PAYOS_API_URL = 'https://api-merchant.payos.vn/v2/payment-requests';

// Function to generate signature
function generateSignature(data, checksumKey) {
    const sortedData = Object.keys(data)
        .sort()
        .reduce((result, key) => {
            result[key] = data[key];
            return result;
        }, {});
    
    const dataString = Object.entries(sortedData)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    
    return crypto
        .createHmac('sha256', checksumKey)
        .update(dataString)
        .digest('hex');
}

// 2. API Tạo link thanh toán VietQR
app.post('/create-payment-link', async (req, res) => {
    try {
        const { amount, accountCode, userName } = req.body;

        const orderCode = Number(Date.now().toString().slice(-6));
        const returnUrl = 'https://your-web-app.com/success';
        const cancelUrl = 'https://your-web-app.com/cancel';
        
        const dataForSignature = {
            amount: amount,
            cancelUrl: cancelUrl,
            description: `Thanh toan MS${accountCode}`,
            orderCode: orderCode,
            returnUrl: returnUrl
        };

        const signature = generateSignature(dataForSignature, PAYOS_CHECKSUM_KEY);

        const body = {
            ...dataForSignature,
            signature: signature
        };

        const response = await axios.post(PAYOS_API_URL, body, {
            headers: {
                'x-client-id': PAYOS_CLIENT_ID,
                'x-api-key': PAYOS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        // Lưu orderCode vào Database để đối soát
        res.json({ 
            checkoutUrl: response.data.data.checkoutUrl, 
            qrCode: response.data.data.qrCode,
            orderCode: orderCode
        });
    } catch (error) {
        console.error("Error creating payment link:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

//3. API Webhook - Nhận thông tin thanh toán từ PayOS
app.post('/payos-webhook', async (req, res) => {
    try {
        const { code, desc, success, data, signature } = req.body;

        // Verify signature
        const dataForSignature = {
            amount: data.amount,
            description: data.description,
            orderCode: data.orderCode,
            transactionDateTime: data.transactionDateTime,
            accountNumber: data.accountNumber,
            reference: data.reference,
            currency: data.currency
        };

        const computedSignature = generateSignature(dataForSignature, PAYOS_CHECKSUM_KEY);

        if (computedSignature !== signature) {
            console.log("Invalid signature");
            return res.status(400).json({
                error: 1,
                message: "Invalid signature",
                data: null
            });
        }

        if (success) {
            console.log("Thanh toán thành công đơn hàng:", data.orderCode);
            // TẠI ĐÂY: Cập nhật database, gửi email, v.v.
            // Ví dụ: updateDatabase(data.orderCode, "Đã thanh toán");
        }

        // PHẢI trả về 2XX để xác nhận webhook
        return res.status(200).json({
            error: 0,
            message: "Ok",
            data: null
        });

    } catch (error) {
        console.error("Webhook error:", error);
        return res.status(500).json({
            error: 99,
            message: "Internal error",
            data: null
        });
    }
});

// 4. Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});