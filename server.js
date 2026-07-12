const express = require('express');
const { Pool } = require('pg');
const FAKE_AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const app = express();
const PORT = process.env.PORT || 3000;

// 1. Initialize PostgreSQL Connection Pool
// In production/Docker, these environment variables will be passed dynamically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/mydb',
  // Maximum number of clients in the pool
  max: 10,
  // Time a client can sit idle before being closed
  idleTimeoutMillis: 30000, 
  // Time to wait for a connection before throwing an error
  connectionTimeoutMillis: 2000,
});

app.use(express.json());

// 2. Shallow Health Check (Liveness Probe)
// Simply tells the load balancer / orchestrator if the Express server is up and running.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 3. Deep Health Check (Readiness Probe)
// Checks if the application can actually talk to its dependencies (the database).
app.get('/health/ready', async (req, res) => {
  try {
    // Run a trivial query to ensure the database connection is alive
    await pool.query('SELECT 1');
    
    res.status(200).json({
      status: 'READY',
      database: 'CONNECTED',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'NOT_READY',
      database: 'DISCONNECTED',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 4. Sample API Route (Simulating a real feature)
app.get('/api/v1/users', async (req, res) => {
  try {
    // In a real app, this would fetch from a 'users' table
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({
      success: true,
      message: "Fetched data successfully",
      dbTime: result.rows[0].current_time
    });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// 5. Graceful Shutdown Management
// Crucial for CI/CD. When a new container deploys, the orchestrator sends a SIGTERM signal.
// We catch it, stop accepting new requests, close DB connections, and then exit.
const gracefulShutdown = () => {
  console.log('Received shutdown signal (SIGTERM/SIGINT). Closing HTTP server...');
  
  server.close(async () => {
    console.log('HTTP server closed. Closing database pool...');
    try {
      await pool.end();
      console.log('Database pool closed safely. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('Error closing database pool during shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);