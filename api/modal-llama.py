"""
Python Vercel Function - Bridge to Modal Llama Model

This function uses the Modal Python SDK to call the deployed Pricer service,
which isn't directly accessible via HTTP (uses @modal.method, not @modal.web_endpoint).
"""

from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle POST requests for price prediction"""
        try:
            print("=" * 60)
            print("🐍 MODAL LLAMA BRIDGE - Request received")
            print("=" * 60)

            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            description = data.get('description')
            print(f"📝 Description: {description[:50]}..." if len(description) > 50 else f"📝 Description: {description}")

            if not description:
                self.send_error(400, "Missing 'description' in request body")
                return

            # Import Modal here (only when function is invoked)
            print("📦 Importing Modal SDK...")
            import modal
            print(f"✅ Modal SDK version: {modal.__version__ if hasattr(modal, '__version__') else 'unknown'}")

            # Modal SDK authentication via environment variables
            print("🔐 Checking environment variables...")
            modal_token_id = os.environ.get('MODAL_TOKEN_ID')
            modal_token_secret = os.environ.get('MODAL_TOKEN_SECRET')

            # Log presence (not actual values for security)
            print(f"   MODAL_TOKEN_ID: {'✅ Set' if modal_token_id else '❌ Missing'} ({modal_token_id[:10]}... if set)" if modal_token_id else "   MODAL_TOKEN_ID: ❌ Missing")
            print(f"   MODAL_TOKEN_SECRET: {'✅ Set' if modal_token_secret else '❌ Missing'} ({len(modal_token_secret)} chars)" if modal_token_secret else "   MODAL_TOKEN_SECRET: ❌ Missing")

            if not modal_token_id or not modal_token_secret:
                error_msg = "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables required"
                print(f"❌ {error_msg}")
                raise Exception(error_msg)

            # Connect to deployed Modal service
            print("🔌 Connecting to Modal service 'pricer-service'...")
            # Modal SDK automatically reads MODAL_TOKEN_ID and MODAL_TOKEN_SECRET from environment
            PricerClass = modal.Cls.from_name("pricer-service", "Pricer")
            print("✅ Got Pricer class reference")

            print("🏗️  Instantiating Pricer...")
            pricer = PricerClass()
            print("✅ Pricer instance created")

            # Call the remote method
            print("📞 Calling remote price method...")
            price = pricer.price.remote(description)
            print(f"✅ Got price: ${price}")

            # Return result
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            response = json.dumps({
                'price': float(price),
                'source': 'modal-llama'
            })
            self.wfile.write(response.encode('utf-8'))

        except Exception as e:
            print("=" * 60)
            print("❌ ERROR OCCURRED")
            print("=" * 60)
            print(f"Error type: {type(e).__name__}")
            print(f"Error message: {str(e)}")

            # Print full traceback for debugging
            import traceback
            print("Full traceback:")
            traceback.print_exc()
            print("=" * 60)

            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            error_response = json.dumps({
                'error': str(e),
                'price': 0
            })
            self.wfile.write(error_response.encode('utf-8'))

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

        response = json.dumps({
            'status': 'ok',
            'service': 'modal-llama-bridge'
        })
        self.wfile.write(response.encode('utf-8'))
