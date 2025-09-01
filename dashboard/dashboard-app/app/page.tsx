'use client';
import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

type Point = { time: string; temp: number; hum: number; mq: number };
type AlertType = 'temp' | 'smoke' | 'fire';
type AlertItem = { id: number; type: AlertType; msg: string };

export default function Dashboard() {
    const [dataPoints, setDataPoints] = useState<Point[]>([]);
    const [current, setCurrent] = useState({ temp: 0, hum: 0, mq: 0 });
    const [currentEdge, setCurrentEdge] = useState<string | null>(null);
    const [alerts, setAlerts] = useState<AlertItem[]>([]);
    const [fireImage, setFireImage] = useState<string | null>(null);

    const COOLDOWN_MS = 60_000;
    const lastAlertRef = useState<Record<AlertType, number>>({
        temp: 0, smoke: 0, fire: 0
    })[0];

    function addAlert(type: AlertType, msg: string) {
        const now = Date.now();
        if (now - lastAlertRef[type] < COOLDOWN_MS) return;
        lastAlertRef[type] = now;

        setAlerts(prev => [
            ...prev,
            { id: now + Math.random(), type, msg }
        ]);
    }

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            // YOLO fire image
            if (data.fireImage) {
                setFireImage(data.fireImage);
                addAlert('fire', 'YOLO detected fire!');
                return;
            }

            // ARTag edge detection
            if (data.currentEdge) {
                setCurrentEdge(data.currentEdge);
                return;
            }

            // Environmental sensor data
            if (data.temperature !== undefined && data.mq135 !== undefined) {
                setCurrent({
                    temp: data.temperature,
                    hum: data.humidity,
                    mq: data.mq135
                });

                setDataPoints(prev => [
                    ...prev.slice(-19),
                    {
                        time: new Date().toLocaleTimeString(),
                        temp: data.temperature,
                        hum: data.humidity,
                        mq: data.mq135
                    }
                ]);

                // 
                if (data.temperature > 34) {
                    addAlert('temp', `Fire Alert (High Temp): ${data.temperature}°C`);
                }
                if (data.mq135 > 700) {
                    addAlert('smoke', `Fire Alert (Smoke): MQ135 = ${data.mq135}`);
                }
            }
        };

        return () => ws.close();
    }, []);

    const generateChart = (label: string, key: keyof Point, color: string) => ({
        labels: dataPoints.map(d => d.time),
        datasets: [{
            label,
            data: dataPoints.map(d => d[key] as number),
            borderColor: color,
            tension: 0.1,
            pointRadius: 1
        }]
    });

    const calculateMinMax = (key: keyof Point) => {
        const values = dataPoints.map(d => d[key] as number).filter(v => typeof v === 'number' && !isNaN(v));
        if (!values.length) return { min: 0, max: 1 };
        const min = Math.min(...values);
        const max = Math.max(...values);
        return { min: Math.floor(min - 2), max: Math.ceil(max + 2) };
    };

    const chartOptions = (key: keyof Point) => {
        const range = calculateMinMax(key);
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: true },
                y: { min: range.min, max: range.max }
            },
            plugins: {
                legend: { position: 'top' as const }
            }
        };
    };

    return (
        <div className="p-4 space-y-10 max-w-4xl mx-auto">

            {/* 🔔 多条预警并列展示 */}
            <div className="space-y-2">
                {alerts.map(a => (
                    <div
                        key={a.id}
                        className={`text-white text-center p-3 rounded-md ${a.type === 'temp' ? 'bg-red-600'
                                : a.type === 'smoke' ? 'bg-orange-500'
                                    : 'bg-purple-600'
                            }`}
                    >
                        <span className="font-semibold">{a.msg}</span>
                        <button
                            className="ml-4 px-3 py-1 bg-white text-black rounded"
                            onClick={() => setAlerts(prev => prev.filter(x => x.id !== a.id))}
                        >
                            Close
                        </button>
                    </div>
                ))}
            </div>

            {/* Fire image display */}
            {fireImage && (
                <div className="text-center">
                    <h2 className="text-lg font-semibold mb-2">Fire Detected Image</h2>
                    <img
                        src={`data:image/jpeg;base64,${fireImage}`}
                        alt="Detected fire"
                        className="mx-auto max-h-80 rounded shadow"
                    />
                    <div className="mt-2">
                        <button
                            className="px-3 py-1 bg-gray-200 rounded"
                            onClick={() => setFireImage(null)}
                        >
                            Clear Image
                        </button>
                    </div>
                </div>
            )}

            <h1 className="text-2xl font-bold text-center">IoT Realtime Dashboard</h1>

            {/* Sensor values */}
            <div className="grid grid-cols-3 gap-4 text-center text-lg">
                <div>Temperature: {current.temp}°C</div>
                <div>Humidity: {current.hum}%</div>
                <div>MQ135: {current.mq}</div>
            </div>

            {/* Temperature chart */}
            <div className="w-full max-w-md mx-auto">
                <h2 className="text-xl font-semibold text-center">Temperature Over Time</h2>
                <div style={{ height: '220px' }}>
                    <Line data={generateChart('Temperature', 'temp', 'red')} options={chartOptions('temp')} />
                </div>
            </div>

            {/* MQ135 chart */}
            <div className="w-full max-w-md mx-auto">
                <h2 className="text-xl font-semibold text-center">MQ135 Over Time</h2>
                <div style={{ height: '220px' }}>
                    <Line data={generateChart('Air Quality', 'mq', 'green')} options={chartOptions('mq')} />
                </div>
            </div>

            {/* Edge detection from ARTag */}
            <div className="w-full max-w-sm mx-auto border rounded-xl p-4 mt-10">
                <h2 className="text-xl font-semibold mb-4 text-center">Current Track Section</h2>
                <svg width="200" height="200" viewBox="0 0 200 200" className="mx-auto">
                    <line x1="20" y1="20" x2="180" y2="20"
                        stroke={currentEdge === 'top' ? 'green' : '#ccc'} strokeWidth="8" />
                    <line x1="180" y1="20" x2="180" y2="180"
                        stroke={currentEdge === 'right' ? 'green' : '#ccc'} strokeWidth="8" />
                    <line x1="180" y1="180" x2="20" y2="180"
                        stroke={currentEdge === 'bottom' ? 'green' : '#ccc'} strokeWidth="8" />
                    <line x1="20" y1="180" x2="20" y2="20"
                        stroke={currentEdge === 'left' ? 'green' : '#ccc'} strokeWidth="8" />
                </svg>
                <div className="text-center mt-2 text-lg">
                    {currentEdge ? `Current Edge: ${currentEdge}` : 'Waiting for ARTag detection...'}
                </div>
            </div>
        </div>
    );
}
