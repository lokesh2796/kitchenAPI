require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");
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
        const io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
            }
        });

        // Initialize the Socket.IO engine with our logic
        socketEngine.init(io);

        server.listen(PORT, () => {
            console.log(`🚀 Monolithic Server running on port ${PORT}`);
            console.log(`🚀 Socket.IO engine active and listening for events.`);
        });

    } catch (err) {
        console.error(`[StartServer Error] FATAL: ${err.message}`);
        process.exit(1);
    }
}

startServer();
