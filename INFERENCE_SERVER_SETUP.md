# Inference Server Setup (GPU VPS)

Quick guide to get the Obelisk inference service running on a dedicated GPU server.

**Prerequisites:** NVIDIA drivers + CUDA already installed. Python 3.10+.

---

## 1. Clone the repo

```bash
cd ~
git clone git@github.com:ohnodev/obelisk-core.git
cd obelisk-core
```

## 2. Create Python venv & install deps

```bash
python3 -m venv venv
source venv/bin/activate

# Install PyTorch with CUDA support first (adjust cu121/cu124 to match your CUDA version)
# Check CUDA version: nvcc --version or nvidia-smi
pip install torch --index-url https://download.pytorch.org/whl/cu121

# Install remaining dependencies (from repo root: pip install -e .)
# For vLLM backend: pip install -e ".[vllm]"
pip install -e .
```

## 3. Verify GPU is detected

```bash
source venv/bin/activate
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0)}') if torch.cuda.is_available() else None"
```

You should see `CUDA available: True` and your GPU name.

## 4. Configure .env

```bash
cat > .env << 'EOF'
# Bind to all interfaces (required for nginx reverse proxy)
INFERENCE_HOST=0.0.0.0
INFERENCE_PORT=7780

# API key — must match the key on your obelisk-core server
INFERENCE_API_KEY=your-secret-key-here

# Model (default: Qwen/Qwen3-0.6B, auto-downloads on first run)
# INFERENCE_MODEL=Qwen/Qwen3-0.6B

# Device (auto-detects CUDA, but you can force it)
# INFERENCE_DEVICE=cuda

# Backend: "transformers" (default) or "vllm" for faster inference (Qwen3-0.6B supported in vLLM >= 0.8.5)
# INFERENCE_BACKEND=vllm
EOF
```

**Qwen3 sampling (official source):** The service applies the sampling settings from the [Qwen3-0.6B model card — Best Practices](https://huggingface.co/Qwen/Qwen3-0.6B): **thinking mode** (`enable_thinking=True`) — Temperature=0.6, TopP=0.95, TopK=20, MinP=0 (official); **non-thinking mode** (`enable_thinking=False`) — Temperature=0.7, TopP=0.8, TopK=20, MinP=0 (suggested in the same Best Practices section). Conversation history is stored without thinking content (only final replies).

### Optional: vLLM backend

For faster inference with the same API and output (same token-151668 thinking parsing):

```bash
pip install -e ".[vllm]"   # from repo root, in your venv
```

Then set in `.env`: `INFERENCE_BACKEND=vllm`. Requires CUDA; the service will fall back to Transformers if vLLM is not installed or load fails.

## 5. Start the inference service

```bash
source venv/bin/activate
python3 -m uvicorn src.inference.server:app --host 0.0.0.0 --port 7780
```

You should see:
```
Obelisk Inference Service starting...
  Device: cuda
  Auth:   API key required
```

### Run in background (with systemd)

Create `/etc/systemd/system/obelisk-inference.service`:

```ini
[Unit]
Description=Obelisk Inference Service
After=network.target

[Service]
User=root
WorkingDirectory=/root/obelisk-core
ExecStart=/root/obelisk-core/venv/bin/python -m uvicorn src.inference.server:app --host 0.0.0.0 --port 7780
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

Then:
```bash
systemctl daemon-reload
systemctl enable obelisk-inference
systemctl start obelisk-inference

# Check status / logs
systemctl status obelisk-inference
journalctl -u obelisk-inference -f
```

## 6. Test it

```bash
# Health check (no auth needed)
curl http://localhost:7780/health

# Inference (requires API key)
curl -X POST http://localhost:7780/v1/inference \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key-here" \
  -d '{"query": "Hello, who are you?", "system_prompt": "You are a helpful assistant.", "max_tokens": 100}'
```

## 7. Set up nginx reverse proxy + SSL

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/inference`:

```nginx
server {
    listen 80;
    server_name inference.theobelisk.ai;

    location / {
        proxy_pass http://127.0.0.1:7780;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Inference can take a while
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Enable and get SSL:

```bash
ln -s /etc/nginx/sites-available/inference /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get Let's Encrypt certificate (make sure DNS A record points to this server first)
certbot --nginx -d inference.theobelisk.ai
```

## 8. Point obelisk-core to this server

On your **main server** (where obelisk-core runs), update `.env`:

```bash
INFERENCE_SERVICE_URL=https://inference.theobelisk.ai
INFERENCE_API_KEY=your-secret-key-here
```

Then restart obelisk-core:
```bash
./pm2-manager.sh restart core
```

---

## Quick Reference

| What | Command |
|------|---------|
| Start | `systemctl start obelisk-inference` |
| Stop | `systemctl stop obelisk-inference` |
| Logs | `journalctl -u obelisk-inference -f` |
| Health | `curl http://localhost:7780/health` |
| GPU check | `nvidia-smi` |
