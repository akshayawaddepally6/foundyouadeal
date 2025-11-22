#!/usr/bin/env python3
"""
Local Development Server for Modal Llama Bridge

Run this alongside `pnpm dev` to test Modal integration locally.
Usage: python api/dev-server.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import sys


class ModalBridgeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle POST requests for price prediction"""
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            description = data.get('description')
            if not description:
                self.send_error(400, "Missing 'description' in request body")
                return

            print(f"🦙 Received price request: {description[:50]}...")

            # Import Modal here (only when function is invoked)
            try:
                import modal
            except ImportError:
                print("❌ Modal SDK not installed. Run: uv pip install modal")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = json.dumps({
                    'error': 'Modal SDK not installed',
                    'price': 0
                })
                self.wfile.write(error_response.encode('utf-8'))
                return

            # Connect to deployed Modal service
            print("🔌 Connecting to Modal service...")
            PricerClass = modal.Cls.from_name("pricer-service", "Pricer")
            pricer = PricerClass()

            # Call the remote method
            print("📞 Calling Llama model...")
            price = pricer.price.remote(description)
            print(f"✅ Got price: ${price}")

            # Return result
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            response = json.dumps({
                'price': float(price),
                'source': 'modal-llama'
            })
            self.wfile.write(response.encode('utf-8'))

        except Exception as e:
            print(f"❌ Error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            error_response = json.dumps({
                'error': str(e),
                'price': 0
            })
            self.wfile.write(error_response.encode('utf-8'))

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = json.dumps({
            'status': 'ok',
            'service': 'modal-llama-bridge (dev)',
            'port': 3001
        })
        self.wfile.write(response.encode('utf-8'))

    def log_message(self, format, *args):
        """Suppress default request logging"""
        pass


def run_server(port=3001):
    """Start the development server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, ModalBridgeHandler)

    print(f"""
╔══════════════════════════════════════════════════╗
║  🐍 Modal Llama Dev Server                       ║
║                                                  ║
║  Running on: http://localhost:{port}             ║
║  Health check: GET  http://localhost:{port}      ║
║  Predict price: POST http://localhost:{port}     ║
║                                                  ║
║  Press Ctrl+C to stop                            ║
╚══════════════════════════════════════════════════╝
""")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down dev server...")
        httpd.shutdown()
        sys.exit(0)


if __name__ == '__main__':
    run_server()
