const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve all static files from the public directory
app.use(express.static('public'));

// Route to serve index.html by default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Serving files from: ${path.join(__dirname, 'public')}`);
});
