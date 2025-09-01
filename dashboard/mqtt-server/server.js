const mqtt = require('mqtt');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// Telegram config
const TELEGRAM_BOT_TOKEN = '8242326368:AAH525vNXCLVdEuNciMs3fBjZfCHi1ul51A';
const TELEGRAM_CHAT_ID = 8076602494;

// 各自冷却时间记录
const ALERT_INTERVAL = 60 * 1000; // 1 minute cooldown
let lastAlertTime = { temp: 0, smoke: 0, yolo: 0 };

function canSendAlert(type) {
    return Date.now() - lastAlertTime[type] >= ALERT_INTERVAL;
}

function sendTelegramTextAlert(message, type) {
    if (!canSendAlert(type)) return;
    lastAlertTime[type] = Date.now();

    axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message
    }).then(() => console.log(`Telegram ${type} alert sent`))
        .catch(err => console.error(`Telegram ${type} alert failed:`, err.message));
}

function sendTelegramImageAlert(base64Image) {
    if (!canSendAlert('yolo')) return;
    lastAlertTime.yolo = Date.now();

    const buffer = Buffer.from(base64Image, 'base64');
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', 'Fire image detected by YOLO');
    form.append('photo', buffer, { filename: 'fire.jpg', contentType: 'image/jpeg' });

    axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, {
        headers: form.getHeaders()
    }).then(() => console.log('Telegram fire image sent'))
        .catch(err => {
            console.error('Failed to send image:', err.message);
            console.log(err.response?.data);
        });
}

// WebSocket setup
const wss = new WebSocket.Server({ port: 8080 });
let sockets = [];

wss.on('connection', ws => {
    sockets.push(ws);
    ws.on('close', () => {
        sockets = sockets.filter(s => s !== ws);
    });
});

function broadcast(data) {
    const payload = JSON.stringify(data);
    sockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    });
}

// MQTT connection
const mqttClient = mqtt.connect({
    host: 'a1dtwlsw1olgol-ats.iot.eu-central-1.amazonaws.com',
    port: 8883,
    protocol: 'mqtts',
    key: fs.readFileSync('./private.pem.key'),
    cert: fs.readFileSync('./certificate.pem.crt'),
    ca: fs.readFileSync('./AmazonRootCA1.pem'),
});

mqttClient.on('connect', () => {
    console.log('Connected to AWS IoT');
    mqttClient.subscribe('dashboard/data');
    mqttClient.subscribe('transbot/tag');
    mqttClient.subscribe('esp8266/pub');
    mqttClient.subscribe('yolo/fire'); // fire image topic
});

mqttClient.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());

        if (topic === 'dashboard/data') {
            broadcast(data);
        }

        if (topic === 'transbot/tag') {
            const tagId = data.id;
            const edgeMap = { 31: 'top', 32: 'right', 33: 'bottom', 34: 'left' };
            const edge = edgeMap[tagId] || null;
            if (edge) {
                broadcast({ currentEdge: edge });
            }
        }

        if (topic === 'esp8266/pub') {
            const temperature = Number(data.temperature);
            const mq135 = Number(data.mq135);

           
            if (temperature > 34) {
                sendTelegramTextAlert(`Fire Alert (High Temperature): ${temperature}°C`, 'temp');
            }
            if (mq135 > 700) {
                sendTelegramTextAlert(`Fire Alert (Smoke Detected): MQ135 = ${mq135}`, 'smoke');
            }

            broadcast(data);
        }

        if (topic === 'yolo/fire') {
            if (data.type === 'fire_image' && data.image) {
                broadcast({ fireImage: data.image });
                sendTelegramImageAlert(data.image);
            }
        }

    } catch (err) {
        console.error('Error handling MQTT message:', err);
    }
});
