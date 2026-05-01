require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");
const { fork } = require('child_process');
const path = require('path');
const app = require('./app');
const connectDB = require('./config/db');
const { initStatusCache } = require('./utils/statusLookupCache');
const socketEngine = require('./utils/socket');

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await connectDB();
        console.log(`[Database] Successfully connected to MongoDB.`);
        
        await initStatusCache();
        console.log(`[Cache] Status lookup cache initialized.`);

        const server = http.createServer(app);
        const allowedOrigins = [
            'http://localhost:4200',
            'http://localhost:8100',
            'http://localhost:5000',
            'http://192.168.31.188:8100',
            'capacitor://localhost',
            'ionic://localhost',
            'https://homekitchen-production.up.railway.app'
        ];

        const io = new Server(server, {
            cors: {
                origin: allowedOrigins,
                methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
            },
            pingInterval: 25000,
            pingTimeout: 20000,
            maxHttpBufferSize: 1e6,       // 1MB max payload per message
            connectionStateRecovery: {
                maxDisconnectionDuration: 2 * 60 * 1000  // 2 min — recover missed events
            }
        });

        // Initialize the Socket.IO engine with our logic
        socketEngine.init(io);

        server.listen(PORT, () => {
            console.log(`🚀 Monolithic Server running on port ${PORT}`);
            console.log(`🚀 Socket.IO engine active and listening for events.`);
        });

        // ── Background Workers (child processes) ──────────────────────────
        // Only start when Redis is configured — skip in environments without it
        // so local dev without Redis doesn't crash.
        if (process.env.REDIS_URL || process.env.NODE_ENV !== 'test') {
            const workers = [
                { name: 'AcceptanceWorker',  file: 'acceptance.worker.js'  },
                { name: 'SchedulerWorker',   file: 'scheduler.worker.js'   },
                { name: 'NotifWorker',       file: 'notification.worker.js' },
            ];

            for (const def of workers) {
                const workerPath = path.join(__dirname, 'workers', def.file);

                const spawnWorker = () => {
                    const child = fork(workerPath, [], {
                        env:   { ...process.env },
                        stdio: 'inherit',
                    });

                    child.on('exit', (code, signal) => {
                        console.warn(`[${def.name}] Exited (code=${code} signal=${signal}) — restarting in 5s`);
                        setTimeout(spawnWorker, 5000);
                    });

                    console.log(`[${def.name}] Started (PID ${child.pid})`);
                    return child;
                };

                spawnWorker();
            }
        }

    } catch (err) {
        console.error(`[StartServer Error] FATAL: ${err.message}`);
        process.exit(1);
    }
}

startServer();
