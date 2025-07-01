# Test Server for GRQ Validation Dashboard

This directory contains scripts to start a local test server for the GRQ Validation Dashboard.

## Quick Start

### Option 1: Using the shell script (Recommended)
```bash
# Start server on default port (8000)
./tests/start-server.sh

# Start server on custom port
./tests/start-server.sh 3000
```

### Option 2: Using Deno directly
```bash
# Start server on default port (8000)
deno run --allow-net --allow-read tests/start-test-server.js

# Start server on custom port
deno run --allow-net --allow-read tests/start-test-server.js 3000
```

## What it does

The test server:
- Serves static files from the `docs/` directory
- Handles all file types (HTML, CSS, JS, JSON, CSV, TSV, images, etc.)
- Sets appropriate MIME types for different file extensions
- Disables caching to ensure fresh content during development
- Provides proper error handling for missing files

## Features

- **Static File Serving**: Serves all files from the `docs/` directory
- **MIME Type Support**: Automatically sets correct content types
- **No Caching**: Ensures fresh content during development
- **Error Handling**: Proper 404 and 500 error responses
- **Port Configuration**: Customizable port via command line argument
- **Cross-platform**: Works on macOS, Linux, and Windows

## Requirements

- [Deno](https://deno.land/) runtime (version 1.0 or later)

## File Structure

```
tests/
├── start-test-server.js    # Main server script
├── start-server.sh         # Shell script wrapper
└── README.md              # This file
```

## Troubleshooting

### Port already in use
If you get a port conflict error, try a different port:
```bash
./tests/start-server.sh 8080
```

### Permission denied
Make sure the shell script is executable:
```bash
chmod +x tests/start-server.sh
```

### Deno not found
Install Deno from https://deno.land/ or use your system's package manager.

## Development

The server is designed for development and testing purposes. For production deployment, consider using a more robust web server like nginx or Apache. 