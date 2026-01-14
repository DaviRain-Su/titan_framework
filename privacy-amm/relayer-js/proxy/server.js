const http = require('http');
const https = require('https');
const { URL } = require('url');

const target = process.env.TARGET_RPC_URL;
if (!target) {
    throw new Error('Missing TARGET_RPC_URL');
}

const authToken = process.env.AUTH_TOKEN;
const listenPort = Number(process.env.PORT || 8787);

const targetUrl = new URL(target);
const transport = targetUrl.protocol === 'https:' ? https : http;

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (authToken && req.headers['x-auth-token'] !== authToken) {
        return sendJson(res, 401, { error: 'Unauthorized' });
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk;
    });

    req.on('end', () => {
        const options = {
            method: 'POST',
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            path: targetUrl.pathname || '/',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const proxyReq = transport.request(options, proxyRes => {
            let responseData = '';
            proxyRes.on('data', chunk => {
                responseData += chunk;
            });
            proxyRes.on('end', () => {
                const contentType = proxyRes.headers['content-type'] || 'application/json';
                res.writeHead(proxyRes.statusCode || 502, { 'Content-Type': contentType });
                res.end(responseData);
            });
        });

        proxyReq.on('error', err => {
            sendJson(res, 502, { error: err.message });
        });

        proxyReq.write(body);
        proxyReq.end();
    });
});

server.listen(listenPort, () => {
    console.log(`RPC proxy listening on ${listenPort}`);
});
